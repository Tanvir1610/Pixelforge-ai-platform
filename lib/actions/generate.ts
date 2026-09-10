"use server";

import { revalidatePath } from "next/cache";
import { requireOrgRole } from "@/lib/auth/session";
import { startAnalysisRun } from "@/lib/repositories/generation";
import { runPlanningStage, PLANNING_STEPS } from "@/lib/ai/planning-stage";
import { runAnalysisStage, ANALYSIS_STAGE_STEPS } from "@/lib/ai/orchestrator";
import { getLatestArtifact } from "@/lib/repositories/artifacts";
import type { DesignAnalysis } from "@/lib/ai/schemas";
import { GENERATION_STEPS } from "@/lib/ai/generation-stage";
import { generateStep, loadGenerationPlan, type StepOutcome } from "@/lib/ai/incremental-generation";
import { isInferenceConfigured } from "@/lib/ai/bootstrap";
import { listProjects } from "@/lib/repositories/projects";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * Driving code generation from a request.
 *
 * Split into three actions rather than one, because each has to finish inside a
 * serverless invocation. Planning is two model calls; generation is one per
 * build-order step and the client asks for the next when the last returns.
 *
 * The single-call `runGenerationStage` still exists and is still the right
 * shape for a worker with a machine — it also builds, which nothing here can.
 */
export interface PlanOutcome {
  ok: boolean;
  message: string;
  runId?: string;
  steps?: string[];
}

async function currentProject() {
  const session = await requireOrgRole("developer");
  const projects = await listProjects(session, 1);
  return { session, project: projects[0] ?? null };
}

/**
 * Architecture and component plans.
 *
 * Idempotent by intent: running it again replaces the plans, which is what a
 * user who disliked the last result wants.
 */
export async function planProjectAction(): Promise<PlanOutcome> {
  const { session, project } = await currentProject();

  if (session.demo) return { ok: false, message: "Connect Supabase to plan a real project." };
  if (!project) return { ok: false, message: "Create a project and import a design first." };
  if (!isInferenceConfigured()) {
    return { ok: false, message: "No AI provider is configured. Set ANTHROPIC_API_KEY to generate code." };
  }

  // Planning consumes the design analysis rather than re-deriving it, so a
  // project that has only been imported has nothing to plan from. Running it
  // here rather than refusing: "run the analysis first" is a step the user
  // gains nothing by performing by hand, and forgetting it was the difference
  // between this button working and failing on its first call.
  const analysis = await getLatestArtifact<DesignAnalysis>(project.id, "design_analysis");
  if (!analysis) {
    const analysisRunId = await startAnalysisRun(project.id, "manual", ANALYSIS_STAGE_STEPS);
    const analysed = await runAnalysisStage({
      organizationId: session.organization.id,
      projectId: project.id,
      runId: analysisRunId,
    });

    if (!analysed.ok) {
      return {
        ok: false,
        runId: analysisRunId,
        message: analysed.errorMessage ?? "The design analysis failed, so there is nothing to plan from.",
      };
    }
  }

  const runId = await startAnalysisRun(project.id, "manual", PLANNING_STEPS);

  const outcome = await runPlanningStage({
    organizationId: session.organization.id,
    projectId: project.id,
    runId,
  });

  revalidatePath("/dashboard/analysis");

  if (!outcome.ok) {
    return { ok: false, message: outcome.errorMessage ?? "Planning failed.", runId };
  }

  return {
    ok: true,
    runId,
    steps: outcome.architecture?.buildOrder ?? [],
    message: `Planned ${outcome.architecture?.buildOrder.length ?? 0} build steps.`,
  };
}

export interface CodegenStart {
  ok: boolean;
  message: string;
  runId?: string;
  total?: number;
  steps?: string[];
}

/** Opens the generation run. The client then asks for each step in turn. */
export async function startCodegenAction(): Promise<CodegenStart> {
  const { session, project } = await currentProject();

  if (session.demo) return { ok: false, message: "Connect Supabase to generate real code." };
  if (!project) return { ok: false, message: "Create a project and import a design first." };
  if (!isInferenceConfigured()) {
    return { ok: false, message: "No AI provider is configured. Set ANTHROPIC_API_KEY to generate code." };
  }

  const plan = await loadGenerationPlan(project.id);
  if (!plan) {
    return { ok: false, message: "Plan the project before generating — the build order comes from that." };
  }

  const runId = await startAnalysisRun(project.id, "manual", GENERATION_STEPS);

  return {
    ok: true,
    runId,
    total: plan.architecture.buildOrder.length,
    steps: plan.architecture.buildOrder,
    message: `Generating ${plan.architecture.buildOrder.length} steps.`,
  };
}

/** One build-order step. Called repeatedly until `done`. */
export async function generateStepAction(input: { runId: string; index: number }): Promise<StepOutcome> {
  const { session, project } = await currentProject();

  if (!project) {
    return {
      ok: false, index: input.index, total: 0, label: "", done: true,
      errorCode: "no_project", errorMessage: "Create a project and import a design first.",
    };
  }

  // The run has to belong to this project, or one workspace could drive
  // another's generation by passing its id.
  const supabase = createServiceClient();
  const { data: run } = await supabase
    .from("generation_runs")
    .select("id, project_id")
    .eq("id", input.runId)
    .maybeSingle<{ id: string; project_id: string }>();

  if (!run || run.project_id !== project.id) {
    return {
      ok: false, index: input.index, total: 0, label: "", done: true,
      errorCode: "not_found", errorMessage: "That generation run doesn't belong to this project.",
    };
  }

  const outcome = await generateStep({
    organizationId: session.organization.id,
    projectId: project.id,
    runId: input.runId,
    actorUserId: session.user.id,
    index: input.index,
  });

  if (outcome.done) {
    revalidatePath("/dashboard");
    revalidatePath("/dashboard/analysis");
  }

  return outcome;
}
