import "server-only";

import { createClient, createServiceClient } from "@/lib/supabase/server";
import type { GenerationRunRow, GenerationStepRow, GenerationTrigger, RunStatus } from "@/lib/db/database.types";

/** The analysis pipeline, in order. Keys are stable; labels are user-facing. */
export const ANALYSIS_STEPS: [string, string][] = [
  ["fetch_file", "Reading your Figma file"],
  ["analyse_layout", "Analysing layout"],
  ["detect_components", "Detecting components"],
  ["extract_typography", "Extracting typography"],
  ["extract_colours", "Analysing colours"],
  ["map_assets", "Mapping assets"],
  ["infer_responsive", "Understanding responsive behaviour"],
  ["persist", "Building component tree"],
];

/**
 * Opens a run with all its steps in one call, so the UI has rows to subscribe
 * to the instant the user clicks Import. Authorisation happens inside the
 * function via can_write_project.
 */
export async function startAnalysisRun(
  projectId: string,
  trigger: GenerationTrigger = "import",
  // Which stage's steps to open the run with. Planning and generation have
  // their own; defaulting to the analysis list keeps every existing caller.
  steps: [string, string][] = ANALYSIS_STEPS,
): Promise<string> {
  const supabase = await createClient();
  if (!supabase) throw new Error("Supabase is not configured.");

  const { data, error } = await supabase.rpc("start_generation_run", {
    p_project_id: projectId,
    p_trigger: trigger,
    p_steps: steps,
  });

  if (error) {
    if (error.code === "42501") throw new Error("You do not have permission to run generation on this project.");
    throw new Error(`Could not start the run: ${error.message}`);
  }
  return data as string;
}

/**
 * Step and run updates come from the worker, so they use the service role: the
 * user's session may well have ended before the run finishes.
 */
export async function markStep(
  runId: string,
  key: string,
  status: RunStatus,
  resultSummary?: string,
): Promise<void> {
  const supabase = createServiceClient();
  const timestamps =
    status === "running"
      ? { started_at: new Date().toISOString() }
      : status === "completed" || status === "failed"
        ? { finished_at: new Date().toISOString() }
        : {};

  await supabase
    .from("generation_steps")
    .update({ status, result_summary: resultSummary ?? null, ...timestamps })
    .eq("generation_run_id", runId)
    .eq("key", key);

  // Progress is derived from completed steps rather than tracked separately, so
  // the two can never disagree.
  const { data: steps } = await supabase
    .from("generation_steps")
    .select("status")
    .eq("generation_run_id", runId);

  if (steps?.length) {
    const done = steps.filter((step) => step.status === "completed").length;
    await supabase
      .from("generation_runs")
      .update({ progress: Math.round((done / steps.length) * 100) })
      .eq("id", runId);
  }
}

export async function markRun(
  runId: string,
  status: RunStatus,
  error?: { code: string; message: string },
): Promise<void> {
  const supabase = createServiceClient();
  await supabase
    .from("generation_runs")
    .update({
      status,
      error_code: error?.code ?? null,
      error_message: error?.message ?? null,
      ...(status === "running" ? { started_at: new Date().toISOString() } : {}),
      ...(status === "completed" || status === "failed" || status === "cancelled"
        ? { finished_at: new Date().toISOString() }
        : {}),
    })
    .eq("id", runId);
}

export interface RunWithSteps {
  run: GenerationRunRow;
  steps: GenerationStepRow[];
}

/** Latest run for a project, for the analysis screen's first paint. */
export async function getLatestRun(projectId: string): Promise<RunWithSteps | null> {
  const supabase = await createClient();
  if (!supabase) return null;

  const { data: run } = await supabase
    .from("generation_runs")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!run) return null;

  const { data: steps } = await supabase
    .from("generation_steps")
    .select("*")
    .eq("generation_run_id", run.id)
    .order("order_index", { ascending: true });

  return { run, steps: steps ?? [] };
}
