import "server-only";

import { createServiceClient } from "@/lib/supabase/server";
import { markRun, markStep } from "@/lib/repositories/generation";
import { recordModelRun, saveArtifact, getLatestArtifact } from "@/lib/repositories/artifacts";
import { loadDesignDocument } from "@/lib/repositories/design-read";
import { runArchitecturePlanner } from "./agents/architecture-planner";
import { runComponentPlanner } from "./agents/component-planner";
import { AnalystError } from "./agents/design-analyst";
import { bootstrapProviders } from "./bootstrap";
import {
  OutOfCreditsError, releaseCredits, reserveCredits, settleCredits, type Reservation,
} from "./credits";
import type { DesignAnalysis } from "./schemas";
import type { ArchitecturePlan, ComponentPlan } from "./planning-schemas";

/**
 * The planning stage: architecture, then components.
 *
 * Sequential on purpose. The component planner needs the directory layout the
 * architecture planner chose, or the two disagree about where files live —
 * and reconciling that afterwards is harder than paying for one extra call.
 */
export interface PlanningStageInput {
  organizationId: string;
  projectId: string;
  runId: string;
}

export interface PlanningStageOutcome {
  ok: boolean;
  architecture?: ArchitecturePlan;
  components?: ComponentPlan;
  errorCode?: string;
  errorMessage?: string;
}

const USER_MESSAGE: Record<string, string> = {
  provider_misconfigured:
    "The AI provider rejected the request as misconfigured, so retrying will not help. Check ANTHROPIC_API_KEY and ANTHROPIC_WORKSPACE_ID — see /api/health.",
  not_configured: "No model provider is configured, so planning cannot run.",
  empty_design: "There's no analysed design to plan from yet.",
  no_analysis: "Run the design analysis before planning.",
  no_credits: "You've used this month's AI credits.",
  invalid_output: "The plan came back in an unusable shape. Try running it again.",
  provider_error: "The model provider didn't respond. Try again in a moment.",
};

export async function runPlanningStage(input: PlanningStageInput): Promise<PlanningStageOutcome> {
  const { organizationId, projectId, runId } = input;
  bootstrapProviders();

  const supabase = createServiceClient();
  await markRun(runId, "running");

  // Declared out here so the catch below can give the claim back.
  let reservation: Reservation | undefined;

  try {
    await markStep(runId, "load_plan_inputs", "running");

    const document = await loadDesignDocument(projectId);
    if (!document) throw new AnalystError("empty_design", USER_MESSAGE.empty_design);

    // Planning consumes the analysis rather than re-deriving it: two stages
    // disagreeing about what the page contains is worse than one extra read.
    const analysis = await getLatestArtifact<DesignAnalysis>(projectId, "design_analysis");
    if (!analysis) throw new AnalystError("empty_design", USER_MESSAGE.no_analysis);

    const { data: project } = await supabase
      .from("projects")
      .select("framework, styling, typescript")
      .eq("id", projectId)
      .single();

    if (!project) throw new AnalystError("empty_design", USER_MESSAGE.empty_design);

    await markStep(runId, "load_plan_inputs", "completed", `${document.frames.length} frames`);

    // Checked once for the stage, not per call — both planners are cheap
    // relative to generation, and a mid-stage stop leaves a half-plan.
    // Reserved rather than read: the old check took no lock, and a failure
    // charged nothing while still spending tokens at the provider.
    try {
      reservation = await reserveCredits({
        organizationId,
        needed: 2,
        purpose: "planning",
        projectId,
      });
    } catch (error) {
      if (error instanceof OutOfCreditsError) {
        throw new AnalystError("no_credits", USER_MESSAGE.no_credits);
      }
      throw error;
    }

    await markStep(runId, "plan_architecture", "running");
    const architecture = await runArchitecturePlanner({
      analysis,
      document,
      framework: project.framework,
      styling: project.styling,
      typescript: project.typescript,
    });

    const architectureRunId = await recordModelRun({
      organizationId, projectId, generationRunId: runId,
      agent: "architecture_planner", purpose: "architecture_planning",
      modelKey: architecture.modelKey, providerKey: architecture.providerKey,
      usage: architecture.usage, attempts: architecture.attempts,
    });

    await saveArtifact({
      projectId, generationRunId: runId, kind: "architecture_plan",
      payload: architecture.plan, modelRunId: architectureRunId,
    });

    await markStep(
      runId, "plan_architecture", "completed",
      `${architecture.plan.routes.length} routes`,
    );

    await markStep(runId, "plan_components", "running");
    const components = await runComponentPlanner({ architecture: architecture.plan, document });

    const componentRunId = await recordModelRun({
      organizationId, projectId, generationRunId: runId,
      agent: "component_planner", purpose: "component_detection",
      modelKey: components.modelKey, providerKey: components.providerKey,
      usage: components.usage, attempts: components.attempts,
    });

    await saveArtifact({
      projectId, generationRunId: runId, kind: "component_plan",
      payload: components.plan, modelRunId: componentRunId,
    });

    await persistPlannedComponents(projectId, components.plan);

    await markStep(
      runId, "plan_components", "completed",
      `${components.plan.components.length} of ${components.candidates} candidates`,
    );

    // Both planner calls landed, so the held claim becomes a charge. Metered
    // off what they produced rather than the flat estimate reserved.
    await settleCredits(
      reservation.id,
      Math.max(
        1,
        Math.ceil((architecture.usage.outputTokens + components.usage.outputTokens) / 1000),
      ),
    );

    await markRun(runId, "completed");
    return { ok: true, architecture: architecture.plan, components: components.plan };
  } catch (error) {
    // Whatever went wrong, the claim goes back: the work did not land.
    if (reservation) {
      await releaseCredits(reservation.id, error instanceof Error ? error.message : "planning failed");
    }
    const code = error instanceof AnalystError ? error.code : "provider_error";
    const message = USER_MESSAGE[code] ?? USER_MESSAGE.provider_error;

    if (error instanceof AnalystError && error.usage.inputTokens > 0) {
      await recordModelRun({
        organizationId, projectId, generationRunId: runId,
        agent: "planner", purpose: "architecture_planning",
        modelKey: error.modelKey, providerKey: error.providerKey,
        usage: error.usage, status: "failed", errorCode: code,
      });
    }

    await markRun(runId, "failed", { code, message });
    return { ok: false, errorCode: code, errorMessage: message };
  }
}

/**
 * Mirrors the plan into `design_components` so the component library screen
 * reads one table regardless of whether a component was found heuristically or
 * planned by a model. `source` keeps the two distinguishable.
 */
async function persistPlannedComponents(projectId: string, plan: ComponentPlan): Promise<void> {
  const supabase = createServiceClient();

  for (const component of plan.components) {
    await supabase.from("design_components").upsert(
      {
        project_id: projectId,
        name: component.name,
        semantic_role: component.semanticRole ?? null,
        instance_count: component.instanceCount,
        confidence: null,
        source: "model",
        description: component.reason,
      },
      { onConflict: "project_id,name" },
    );
  }
}

export const PLANNING_STEPS: [string, string][] = [
  ["load_plan_inputs", "Reading the analysed design"],
  ["plan_architecture", "Planning architecture"],
  ["plan_components", "Planning components"],
];
