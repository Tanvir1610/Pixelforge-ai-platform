import "server-only";

import { createServiceClient } from "@/lib/supabase/server";
import { markRun, markStep } from "@/lib/repositories/generation";
import { getLatestArtifact, recordModelRun, saveArtifact } from "@/lib/repositories/artifacts";
import { loadDesignDocument } from "@/lib/repositories/design-read";
import { writeVersion } from "@/lib/repositories/code";
import { runCodeStep } from "./agents/code-generator";
import { AnalystError } from "./agents/design-analyst";
import { bootstrapProviders } from "./bootstrap";
import type { ArchitecturePlan, ComponentPlan } from "./planning-schemas";

/**
 * Code generation, one build-order step per call.
 *
 * `runGenerationStage` does the whole thing in a single invocation — every
 * model call, then npm install, tsc and a real build in a sandbox. That is the
 * right shape for a worker with a machine under it, and impossible on a
 * serverless request: the model calls alone run for minutes, and the platform
 * kills the function long before the build starts.
 *
 * So this does exactly one step and returns. The caller invokes it again for
 * the next one. Nothing is held in memory between calls, because there is no
 * "between" — each is a separate cold request.
 *
 * Accumulation is free: `writeVersion` carries forward every file the new step
 * did not touch, so version N is the whole project as of step N. That is a
 * property the versioning layer already had; this just leans on it rather than
 * inventing a scratch buffer.
 */
export interface GenerationPlan {
  architecture: ArchitecturePlan;
  components: ComponentPlan;
}

export interface StepOutcome {
  ok: boolean;
  /** Zero-based index of the step just completed. */
  index: number;
  total: number;
  label: string;
  done: boolean;
  filesWritten?: number;
  versionId?: string;
  versionNumber?: number;
  errorCode?: string;
  errorMessage?: string;
}

/**
 * Failures this stage has that the analyst does not.
 *
 * `AnalystError`'s code union is shared across stages and deliberately narrow,
 * so widening it here would loosen it everywhere. These two are local.
 */
export class CodegenError extends Error {
  constructor(
    readonly code: "no_plan" | "out_of_range",
    message: string,
  ) {
    super(message);
    this.name = "CodegenError";
  }
}

const USER_MESSAGE: Record<string, string> = {
  provider_misconfigured:
    "The AI provider rejected the request as misconfigured, so retrying will not help. Check ANTHROPIC_API_KEY and ANTHROPIC_WORKSPACE_ID — see /api/health.",
  not_configured: "No model provider is configured, so code generation cannot run.",
  no_plan: "Run the architecture and component planners before generating.",
  empty_design: "There's no analysed design to generate from yet.",
  no_credits: "You've used this month's AI credits.",
  invalid_output: "The generated code came back in an unusable shape. Try again.",
  provider_error: "The model provider didn't respond. Try again in a moment.",
  out_of_range: "That generation step does not exist.",
};

export async function loadGenerationPlan(projectId: string): Promise<GenerationPlan | null> {
  const [architecture, components] = await Promise.all([
    getLatestArtifact<ArchitecturePlan>(projectId, "architecture_plan"),
    getLatestArtifact<ComponentPlan>(projectId, "component_plan"),
  ]);

  if (!architecture || !components) return null;
  return { architecture, components };
}

/**
 * Runs one build-order step.
 *
 * `index` comes from the caller rather than being inferred from stored state,
 * so a retried request repeats a step instead of skipping one. Repeating is
 * safe — the step rewrites its own files — where skipping silently drops part
 * of the project.
 */
export async function generateStep(input: {
  organizationId: string;
  projectId: string;
  runId: string;
  actorUserId: string;
  index: number;
}): Promise<StepOutcome> {
  const { organizationId, projectId, runId, actorUserId, index } = input;

  bootstrapProviders();
  const supabase = createServiceClient();

  try {
    const plan = await loadGenerationPlan(projectId);
    if (!plan) throw new CodegenError("no_plan", USER_MESSAGE.no_plan);

    const document = await loadDesignDocument(projectId);
    if (!document) throw new AnalystError("empty_design", USER_MESSAGE.empty_design);

    const buildOrder = plan.architecture.buildOrder;
    if (index < 0 || index >= buildOrder.length) {
      throw new CodegenError("out_of_range", USER_MESSAGE.out_of_range);
    }

    const step = buildOrder[index];

    if (index === 0) {
      await markRun(runId, "running");
      await markStep(runId, "load_plans", "completed", `${buildOrder.length} steps`);
      await markStep(runId, "generate_code", "running");
    }

    // Checked per step rather than once up front: a long generation must stop
    // when the balance runs out, not discover it at the end.
    const { data: hasCredits } = await supabase.rpc("has_credits", {
      p_organization_id: organizationId,
      p_needed: 1,
    });
    if (hasCredits === false) throw new AnalystError("no_credits", USER_MESSAGE.no_credits);

    // What already exists, so the model extends the project rather than
    // starting it over. Read back from the version rather than kept in memory.
    const existingFiles = await listCurrentFiles(projectId);

    const result = await runCodeStep({
      step,
      architecture: plan.architecture,
      components: plan.components,
      document,
      existingFiles,
    });

    await recordModelRun({
      organizationId,
      projectId,
      generationRunId: runId,
      agent: "code_generator",
      purpose: "code_generation",
      modelKey: result.modelKey,
      providerKey: result.providerKey,
      usage: result.usage,
      attempts: result.attempts,
    });

    if (result.files.length === 0) {
      throw new AnalystError("invalid_output", `Step "${step}" produced no files.`);
    }

    // Carries forward everything the step did not touch, so this version is the
    // whole project as of now.
    const version = await writeVersion({
      projectId,
      actorUserId,
      files: result.files.map((file) => ({ path: file.path, content: file.content })),
      label: `Step ${index + 1}: ${step}`.slice(0, 120),
      summary: `${result.files.length} files from "${step}".`,
      generationRunId: runId,
    });

    const done = index + 1 >= buildOrder.length;

    await markStep(
      runId,
      "generate_code",
      done ? "completed" : "running",
      `${index + 1}/${buildOrder.length} · ${step}`,
    );

    if (done) {
      await markStep(runId, "write_version", "completed", `v${version.versionNumber}`);
      // No build here. The sandbox needs npm, a writable tree and minutes, none
      // of which a serverless request has. Marked cancelled rather than
      // completed: `run_status` has no "skipped", and reporting a build as
      // passed when nothing compiled anything is the worst kind of green tick.
      await markStep(runId, "build", "cancelled", "Not run — this deployment has no build sandbox");

      await saveArtifact({
        projectId,
        generationRunId: runId,
        kind: "code_plan",
        payload: {
          versionId: version.versionId,
          versionNumber: version.versionNumber,
          steps: buildOrder,
          built: false,
        },
      });

      await markRun(runId, "completed");
      await supabase.from("projects").update({ status: "review" }).eq("id", projectId);
    }

    return {
      ok: true,
      index,
      total: buildOrder.length,
      label: step,
      done,
      filesWritten: result.files.length,
      versionId: version.versionId,
      versionNumber: version.versionNumber,
    };
  } catch (error) {
    const code =
      error instanceof AnalystError || error instanceof CodegenError ? error.code : "provider_error";
    const message = USER_MESSAGE[code] ?? USER_MESSAGE.provider_error;

    console.error("[codegen:step]", index, error);
    await markStep(runId, "generate_code", "failed", message);
    await markRun(runId, "failed", { code, message });
    await supabase.from("projects").update({ status: "failed" }).eq("id", projectId);

    return { ok: false, index, total: 0, label: "", done: true, errorCode: code, errorMessage: message };
  }
}

/** Paths in the project's newest version, for the model's "what exists" list. */
async function listCurrentFiles(projectId: string): Promise<string[]> {
  const supabase = createServiceClient();

  const { data: generated } = await supabase
    .from("generated_projects")
    .select("id, code_versions(id, version_number)")
    .eq("project_id", projectId)
    .maybeSingle<{ id: string; code_versions: { id: string; version_number: number }[] }>();

  const versions = generated?.code_versions ?? [];
  if (versions.length === 0) return [];

  const latest = [...versions].sort((a, b) => b.version_number - a.version_number)[0];

  const { data: files } = await supabase
    .from("generated_files")
    .select("path")
    .eq("code_version_id", latest.id)
    .neq("change_kind", "deleted")
    .order("path");

  return (files ?? []).map((file) => file.path);
}
