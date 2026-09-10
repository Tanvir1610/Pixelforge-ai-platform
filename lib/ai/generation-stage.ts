import "server-only";

import { createServiceClient } from "@/lib/supabase/server";
import { markRun, markStep } from "@/lib/repositories/generation";
import { recordModelRun, saveArtifact, getLatestArtifact } from "@/lib/repositories/artifacts";
import { loadDesignDocument } from "@/lib/repositories/design-read";
import { writeVersion } from "@/lib/repositories/code";
import { finishBuildRun, startBuildRun } from "@/lib/repositories/builds";
import { runBuild, type SandboxFile } from "@/lib/sandbox/runner";
import { runCodeStep } from "./agents/code-generator";
import { AnalystError } from "./agents/design-analyst";
import { bootstrapProviders } from "./bootstrap";
import type { ArchitecturePlan, ComponentPlan } from "./planning-schemas";

/**
 * The generation stage: generate → version → build → repair.
 *
 * Files are written per build-order step and committed as ONE version at the
 * end, so a project is never half-generated on disk. The build then runs in a
 * sandbox, and its errors feed a bounded repair loop.
 */
export interface GenerationStageInput {
  organizationId: string;
  projectId: string;
  runId: string;
  /**
   * The user this generation runs on behalf of.
   *
   * The stage writes with the service role, so the database has no JWT to
   * authorise against. Naming the actor is what keeps a worker from being a way
   * into another tenant's project.
   */
  actorUserId: string;
  /** Hard ceiling on repair passes, so a model that cannot fix its own output
   *  cannot spend a user's entire credit balance trying (§24). */
  maxRepairAttempts?: number;
}

export interface GenerationStageOutcome {
  ok: boolean;
  versionId?: string;
  versionNumber?: number;
  filesWritten?: number;
  buildOk?: boolean;
  repairAttempts?: number;
  errorCode?: string;
  errorMessage?: string;
}

const USER_MESSAGE: Record<string, string> = {
  not_configured: "No model provider is configured, so code generation cannot run.",
  empty_design: "There's no plan to generate from yet — run planning first.",
  no_plan: "Run the architecture and component planners before generating.",
  no_credits: "You've used this month's AI credits.",
  invalid_output: "The generated code came back in an unusable shape. Try again.",
  provider_error: "The model provider didn't respond. Try again in a moment.",
  build_failed: "The generated project didn't build, and the repair attempts didn't fix it.",
};

export async function runGenerationStage(input: GenerationStageInput): Promise<GenerationStageOutcome> {
  const { organizationId, projectId, runId, actorUserId } = input;
  const maxRepairAttempts = input.maxRepairAttempts ?? 2;

  bootstrapProviders();
  const supabase = createServiceClient();
  await markRun(runId, "running");

  try {
    await markStep(runId, "load_plans", "running");

    const [document, architecture, components] = await Promise.all([
      loadDesignDocument(projectId),
      getLatestArtifact<ArchitecturePlan>(projectId, "architecture_plan"),
      getLatestArtifact<ComponentPlan>(projectId, "component_plan"),
    ]);

    if (!document) throw new AnalystError("empty_design", USER_MESSAGE.empty_design);
    if (!architecture || !components) throw new AnalystError("empty_design", USER_MESSAGE.no_plan);

    await markStep(runId, "load_plans", "completed", `${architecture.buildOrder.length} steps`);

    // Generation is the expensive stage: one credit per build-order step plus
    // headroom for repairs. Checked once, before anything is written.
    const { data: hasCredits } = await supabase.rpc("has_credits", {
      p_organization_id: organizationId,
      p_needed: architecture.buildOrder.length + maxRepairAttempts,
    });
    if (hasCredits === false) throw new AnalystError("no_credits", USER_MESSAGE.no_credits);

    // ---- Generate, one build-order step at a time --------------------------
    await markStep(runId, "generate_code", "running");

    const written = new Map<string, string>();
    const rejected: string[] = [];

    for (const step of architecture.buildOrder) {
      const result = await runCodeStep({
        step,
        architecture,
        components,
        document,
        existingFiles: [...written.keys()],
      });

      for (const file of result.files) written.set(file.path, file.content);
      rejected.push(...result.rejectedPaths);

      await recordModelRun({
        organizationId, projectId, generationRunId: runId,
        agent: "code_generator", purpose: "code_generation",
        modelKey: result.modelKey, providerKey: result.providerKey,
        usage: result.usage, attempts: result.attempts,
      });
    }

    if (written.size === 0) {
      throw new AnalystError("invalid_output", "The generator produced no files.");
    }

    await markStep(runId, "generate_code", "completed", `${written.size} files`);

    // ---- Commit one version ------------------------------------------------
    await markStep(runId, "write_version", "running");

    let version = await writeVersion({
      projectId,
      actorUserId,
      files: [...written].map(([path, content]) => ({ path, content })),
      label: "AI generation",
      summary: `Generated ${written.size} files across ${architecture.buildOrder.length} steps.`,
      generationRunId: runId,
    });

    await markStep(runId, "write_version", "completed", `v${version.versionNumber}`);

    // ---- Build, then repair ------------------------------------------------
    await markStep(runId, "build", "running");

    let buildOk = false;
    let repairAttempts = 0;

    for (let iteration = 1; iteration <= maxRepairAttempts + 1; iteration += 1) {
      const buildRunId = await startBuildRun({
        projectId, codeVersionId: version.versionId, generationRunId: runId, backend: "local",
      });

      const files: SandboxFile[] = [...written].map(([path, content]) => ({ path, content }));
      const build = await runBuild(files);

      await finishBuildRun({
        buildRunId,
        status: build.ok ? "completed" : "failed",
        failedPhase: build.failedPhase,
        timings: build.timings,
        errors: build.errors,
        timedOut: build.commands.some((command) => command.timedOut),
        iteration,
      });

      if (build.ok) {
        buildOk = true;
        break;
      }

      if (iteration > maxRepairAttempts) break;

      // Repair pass: the generator sees its own errors and rewrites the files
      // they point at. Bounded, because a model that cannot fix its output in
      // two passes will not fix it in ten.
      repairAttempts += 1;
      await markStep(runId, "build", "running", `Repair attempt ${repairAttempts}`);

      const repair = await runCodeStep({
        step: "repair build errors",
        architecture, components, document,
        existingFiles: [...written.keys()],
        previousErrors: build.errors.map((error) => ({
          filePath: error.filePath, line: error.line, message: error.message,
        })),
      });

      if (repair.files.length === 0) break;

      for (const file of repair.files) written.set(file.path, file.content);

      await recordModelRun({
        organizationId, projectId, generationRunId: runId,
        agent: "code_generator", purpose: "code_repair",
        modelKey: repair.modelKey, providerKey: repair.providerKey,
        usage: repair.usage, attempts: repair.attempts,
      });

      version = await writeVersion({
        projectId,
        actorUserId,
        files: [...written].map(([path, content]) => ({ path, content })),
        label: `Repair ${repairAttempts}`,
        summary: `Fixed ${build.errors.length} build errors.`,
        generationRunId: runId,
      });
    }

    await markStep(
      runId, "build",
      buildOk ? "completed" : "failed",
      buildOk ? `v${version.versionNumber} builds` : `Still failing after ${repairAttempts} repairs`,
    );

    await saveArtifact({
      projectId, generationRunId: runId, kind: "code_plan",
      payload: {
        versionId: version.versionId,
        versionNumber: version.versionNumber,
        files: [...written.keys()],
        rejectedPaths: rejected,
        buildOk,
        repairAttempts,
      },
    });

    await supabase.from("projects").update({ status: buildOk ? "review" : "failed" }).eq("id", projectId);
    await markRun(runId, buildOk ? "completed" : "failed",
      buildOk ? undefined : { code: "build_failed", message: USER_MESSAGE.build_failed });

    return {
      ok: buildOk,
      versionId: version.versionId,
      versionNumber: version.versionNumber,
      filesWritten: written.size,
      buildOk,
      repairAttempts,
      errorCode: buildOk ? undefined : "build_failed",
      errorMessage: buildOk ? undefined : USER_MESSAGE.build_failed,
    };
  } catch (error) {
    const code = error instanceof AnalystError ? error.code : "provider_error";
    const message = USER_MESSAGE[code] ?? USER_MESSAGE.provider_error;

    if (error instanceof AnalystError && error.usage.inputTokens > 0) {
      await recordModelRun({
        organizationId, projectId, generationRunId: runId,
        agent: "code_generator", purpose: "code_generation",
        modelKey: error.modelKey, providerKey: error.providerKey,
        usage: error.usage, status: "failed", errorCode: code,
      });
    }

    await markRun(runId, "failed", { code, message });
    await supabase.from("projects").update({ status: "failed" }).eq("id", projectId);

    return { ok: false, errorCode: code, errorMessage: message };
  }
}

export const GENERATION_STEPS: [string, string][] = [
  ["load_plans", "Reading the architecture and component plans"],
  ["generate_code", "Generating code"],
  ["write_version", "Saving a version"],
  ["build", "Installing, typechecking and building"],
];
