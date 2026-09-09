import "server-only";

import { createClient, createServiceClient } from "@/lib/supabase/server";
import type { DeploymentPhaseKey, HostProviderKey, RunStatus } from "@/lib/db/database.types";
import type { Session } from "@/lib/auth/session";

/**
 * Deployment persistence.
 *
 * Opening a deployment goes through an RPC that refuses versions whose build
 * did not pass — the rule lives in the database so it holds even if a caller
 * forgets to check.
 */
export async function startDeployment(params: {
  projectId: string;
  codeVersionId: string;
  provider: HostProviderKey;
  environment?: "preview" | "production";
  generationRunId?: string;
}): Promise<string> {
  const supabase = await createClient();
  if (!supabase) throw new Error("Supabase is not configured.");

  const { data, error } = await supabase.rpc("start_deployment", {
    p_project_id: params.projectId,
    p_code_version_id: params.codeVersionId,
    p_provider: params.provider,
    p_environment: params.environment ?? "production",
    p_generation_run_id: params.generationRunId ?? null,
  });

  if (error) {
    if (error.code === "42501") throw new Error("You do not have permission to deploy this project.");
    // The build gate raises check_violation; surface its message, which is
    // already written for a user.
    if (error.code === "23514" || error.message.includes("build did not pass")) {
      throw new Error("That version hasn't built successfully yet, so it can't be deployed.");
    }
    if (error.message.includes("not been built")) {
      throw new Error("That version hasn't been built yet. Run a build first.");
    }
    throw new Error(`Could not start the deployment: ${error.message}`);
  }

  return data as string;
}

export async function updateDeploymentPhase(params: {
  deploymentId: string;
  phase: DeploymentPhaseKey;
  providerDeploymentId?: string;
  url?: string;
}): Promise<void> {
  const supabase = createServiceClient();
  await supabase.rpc("update_deployment_phase", {
    p_deployment_id: params.deploymentId,
    p_phase: params.phase,
    p_provider_deployment_id: params.providerDeploymentId ?? null,
    p_url: params.url ?? null,
  });
}

export async function finishDeployment(params: {
  deploymentId: string;
  status: RunStatus;
  url?: string;
  errorCode?: string;
  errorMessage?: string;
}): Promise<void> {
  const supabase = createServiceClient();
  await supabase.rpc("finish_deployment", {
    p_deployment_id: params.deploymentId,
    p_status: params.status,
    p_url: params.url ?? null,
    p_error_code: params.errorCode ?? null,
    p_error_message: params.errorMessage ?? null,
  });
}

export interface DeploymentSummary {
  id: string;
  provider: HostProviderKey;
  environment: string;
  status: RunStatus;
  phase: DeploymentPhaseKey;
  url: string | null;
  versionId: string | null;
  errorMessage: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export async function listDeployments(projectId: string, limit = 10): Promise<DeploymentSummary[]> {
  const supabase = await createClient();
  if (!supabase) return [];

  const { data } = await supabase
    .from("deployment_records")
    .select("id, provider, environment, status, phase, url, code_version_id, error_message, created_at, finished_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(limit);

  return (data ?? []).map((row) => ({
    id: row.id,
    provider: row.provider,
    environment: row.environment,
    status: row.status,
    phase: row.phase,
    url: row.url,
    versionId: row.code_version_id,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
  }));
}

/** Which hosts this organization has connected. Never returns a token. */
export async function getConnectedHosts(session: Session) {
  if (session.demo) return [];

  const supabase = await createClient();
  if (!supabase) return [];

  const { data } = await supabase.rpc("my_deployment_connections");
  return (data ?? []).filter((row) => row.is_active);
}
