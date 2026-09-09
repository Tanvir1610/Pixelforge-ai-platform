import "server-only";

import { finishDeployment, startDeployment, updateDeploymentPhase } from "@/lib/repositories/deployments";
import { createServiceClient } from "@/lib/supabase/server";
import { resolveProvider } from "./registry";
import { pollUntilSettled } from "./poll";
import { DEPLOY_ERROR_COPY, DeploymentError, type DeploymentFile, type ProviderKey } from "./types";
import type { HostProviderKey } from "@/lib/db/database.types";

/**
 * The deployment stage.
 *
 * Loads a version's files, hands them to the host, then polls to live. Phase
 * updates are written as they happen so the deploy screen shows real progress
 * rather than a spinner that finishes when the request returns.
 */
export interface DeployStageInput {
  organizationId: string;
  projectId: string;
  codeVersionId: string;
  provider: Exclude<HostProviderKey, "none">;
  environment?: "preview" | "production";
  generationRunId?: string;
  /** Injected at build time by the host, never written into the file set. */
  environmentVariables?: Record<string, string>;
  buildCommand?: string;
  outputDirectory?: string;
  timeoutMs?: number;
}

export interface DeployStageOutcome {
  ok: boolean;
  deploymentId?: string;
  url?: string;
  errorCode?: string;
  errorMessage?: string;
}

export async function runDeployStage(input: DeployStageInput): Promise<DeployStageOutcome> {
  // Opened first: the gate that refuses an unbuilt version lives in this RPC,
  // so nothing is uploaded before the check runs.
  const deploymentId = await startDeployment({
    projectId: input.projectId,
    codeVersionId: input.codeVersionId,
    provider: input.provider,
    environment: input.environment ?? "production",
    generationRunId: input.generationRunId,
  });

  try {
    const files = await loadVersionFiles(input.codeVersionId);
    if (files.length === 0) {
      throw new DeploymentError("invalid_config", "That version has no files to deploy.");
    }

    const { provider, accountId } = await resolveProvider(
      input.organizationId,
      input.provider as ProviderKey,
    );

    const { data: project } = await createServiceClient()
      .from("projects")
      .select("slug")
      .eq("id", input.projectId)
      .single();

    const target = {
      projectName: project?.slug ?? "pixelforge-project",
      environment: input.environment ?? ("production" as const),
      environmentVariables: input.environmentVariables,
      buildCommand: input.buildCommand,
      outputDirectory: input.outputDirectory,
      accountId,
    };

    await updateDeploymentPhase({ deploymentId, phase: "uploading" });

    const handle = await provider.deploy(files, target);

    await updateDeploymentPhase({
      deploymentId,
      phase: "building",
      providerDeploymentId: handle.providerDeploymentId,
      url: handle.url,
    });

    const { state, timedOut } = await pollUntilSettled(provider, handle, target, {
      timeoutMs: input.timeoutMs,
      // Each observed phase is written through, so the UI tracks the host
      // rather than guessing from elapsed time.
      onState: (observed) =>
        updateDeploymentPhase({ deploymentId, phase: observed.phase, url: observed.url }),
    });

    if (state.status === "completed") {
      await finishDeployment({ deploymentId, status: "completed", url: state.url });
      return { ok: true, deploymentId, url: state.url };
    }

    const errorCode = timedOut ? "upstream" : "upstream";
    await finishDeployment({
      deploymentId,
      status: state.status === "cancelled" ? "cancelled" : "failed",
      url: state.url,
      errorCode,
      errorMessage: state.errorMessage ?? DEPLOY_ERROR_COPY.upstream,
    });

    return {
      ok: false,
      deploymentId,
      errorCode,
      errorMessage: state.errorMessage ?? DEPLOY_ERROR_COPY.upstream,
    };
  } catch (error) {
    const isDeploy = error instanceof DeploymentError;
    const code = isDeploy ? error.code : "upstream";
    // Host error text is never surfaced: it leaks identifiers and rarely tells
    // the user what to do.
    const message = DEPLOY_ERROR_COPY[code];

    await finishDeployment({ deploymentId, status: "failed", errorCode: code, errorMessage: message });
    return { ok: false, deploymentId, errorCode: code, errorMessage: message };
  }
}

/** Deleted files are excluded; a version row is a full snapshot. */
async function loadVersionFiles(codeVersionId: string): Promise<DeploymentFile[]> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("generated_files")
    .select("path, content")
    .eq("code_version_id", codeVersionId)
    .neq("change_kind", "deleted");

  return (data ?? [])
    .filter((row): row is { path: string; content: string } => row.content !== null)
    .map((row) => ({ path: row.path, content: row.content }));
}

export const DEPLOY_STEPS: [string, string][] = [
  ["upload", "Uploading the project"],
  ["build", "Building on the host"],
  ["release", "Releasing"],
];
