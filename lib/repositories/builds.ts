import "server-only";

import { createClient, createServiceClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/db/database.types";
import type { ParsedError } from "@/lib/sandbox/parse-errors";
import type { BuildPhase } from "@/lib/sandbox/parse-errors";

/**
 * Build persistence.
 *
 * Opening and closing a run are both RPCs: closing writes the errors and the
 * status together, so a build is never marked finished while its errors are
 * still arriving.
 */
export async function startBuildRun(params: {
  projectId: string;
  codeVersionId?: string;
  generationRunId?: string;
  backend?: "local" | "container" | "microvm";
}): Promise<string> {
  const supabase = await createClient();
  if (!supabase) throw new Error("Supabase is not configured.");

  const { data, error } = await supabase.rpc("start_build_run", {
    p_project_id: params.projectId,
    p_code_version_id: params.codeVersionId ?? null,
    p_generation_run_id: params.generationRunId ?? null,
    p_sandbox_backend: params.backend ?? "local",
  });

  if (error) {
    if (error.code === "42501") throw new Error("You do not have permission to build this project.");
    throw new Error(`Could not start the build: ${error.message}`);
  }
  return data as string;
}

export async function finishBuildRun(params: {
  buildRunId: string;
  status: "completed" | "failed" | "cancelled";
  failedPhase?: BuildPhase | null;
  timings?: Partial<Record<BuildPhase, number>>;
  errors?: ParsedError[];
  timedOut?: boolean;
  iteration?: number;
}): Promise<void> {
  const supabase = createServiceClient();

  await supabase.rpc("finish_build_run", {
    p_build_run_id: params.buildRunId,
    p_status: params.status,
    p_failed_phase: params.failedPhase ?? null,
    p_timings: (params.timings ?? {}) as Json,
    p_errors: (params.errors ?? []) as unknown as Json,
    p_timed_out: params.timedOut ?? false,
    p_iteration: params.iteration ?? 1,
  });
}

export interface BuildSummary {
  id: string;
  status: string;
  failedPhase: string | null;
  errorCount: number;
  warningCount: number;
  versionNumber: number | null;
  timedOut: boolean;
  createdAt: string;
}

export async function getLatestBuild(projectId: string): Promise<BuildSummary | null> {
  const supabase = await createClient();
  if (!supabase) return null;

  const { data } = await supabase
    .from("build_runs")
    .select("id, status, failed_phase, error_count, warning_count, code_version_number, timed_out, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;

  return {
    id: data.id,
    status: data.status,
    failedPhase: data.failed_phase,
    errorCount: data.error_count,
    warningCount: data.warning_count,
    versionNumber: data.code_version_number,
    timedOut: data.timed_out,
    createdAt: data.created_at,
  };
}

/** Errors from a build, worst first, for the repair agent and the code screen. */
export async function getBuildErrors(buildRunId: string, limit = 50) {
  const supabase = await createClient();
  if (!supabase) return [];

  const { data } = await supabase
    .from("build_errors")
    .select("phase, severity, file_path, line, column_number, code, message, iteration")
    .eq("build_run_id", buildRunId)
    .order("severity", { ascending: true })
    .limit(limit);

  return data ?? [];
}
