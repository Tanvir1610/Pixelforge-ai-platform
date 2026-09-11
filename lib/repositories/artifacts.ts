import "server-only";

import { createServiceClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/db/database.types";
import type { ModelPurpose, ModelUsage } from "@/lib/ai/types";

export type ArtifactKind =
  | "design_analysis" | "component_plan" | "architecture_plan"
  | "responsive_plan" | "code_plan" | "visual_report" | "refinement_plan";

/**
 * Records what a model run cost and what it produced.
 *
 * Every call is written, including failed ones — a run that burned tokens and
 * returned nothing still has to appear in the ledger, or cost reporting and the
 * evaluation harness are both wrong.
 */
export async function recordModelRun(params: {
  organizationId: string;
  projectId?: string;
  generationRunId?: string;
  agent: string;
  purpose: ModelPurpose;
  modelKey: string;
  providerKey: string;
  usage: ModelUsage;
  attempts?: number;
  status?: "completed" | "failed";
  errorCode?: string;
}): Promise<string | null> {
  const supabase = createServiceClient();

  // Credits are NOT charged here any more.
  //
  // This used to meter them off output tokens and charge on success, which
  // meant a failed call — tokens already spent at the provider — cost the user
  // nothing, and two concurrent calls could each pass an unlocked balance
  // check. Charging now happens once, when a reservation is settled; see
  // lib/ai/credits.ts. This function stays what its name says: the ledger of
  // what ran, what it produced and what it cost us.
  const status = params.status ?? "completed";

  // One RPC rather than an insert followed by a usage write: a run must never
  // be logged without being charged, or charged without being logged. The
  // function also resolves the provider row, so attribution follows whichever
  // provider actually served the call.
  const { data, error } = await supabase.rpc("record_model_run", {
    p_organization_id: params.organizationId,
    p_project_id: params.projectId ?? null,
    p_generation_run_id: params.generationRunId ?? null,
    p_provider_key: params.providerKey,
    p_model_key: params.modelKey,
    p_purpose: params.purpose,
    p_input_tokens: params.usage.inputTokens,
    p_output_tokens: params.usage.outputTokens,
    p_cost_usd: params.usage.costUsd,
    p_latency_ms: params.usage.latencyMs,
    p_status: status,
    p_credits: 0,
  });

  if (error) return null;

  // agent/attempt/error_code are not RPC parameters; they annotate the row the
  // RPC just created.
  await supabase
    .from("model_runs")
    .update({
      agent: params.agent,
      attempt: params.attempts ?? 1,
      error_code: params.errorCode ?? null,
    })
    .eq("id", data as string);

  return data as string;
}

export async function saveArtifact(params: {
  projectId: string;
  generationRunId?: string;
  kind: ArtifactKind;
  payload: unknown;
  modelRunId?: string | null;
  schemaVersion?: number;
}): Promise<string | null> {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("generation_artifacts")
    .insert({
      project_id: params.projectId,
      generation_run_id: params.generationRunId ?? null,
      kind: params.kind,
      schema_version: params.schemaVersion ?? 1,
      payload: params.payload as Json,
      model_run_id: params.modelRunId ?? null,
    })
    .select("id")
    .single();

  return error ? null : data.id;
}

/** Latest artifact of a kind, for screens that render a previous run's output. */
export async function getLatestArtifact<T>(projectId: string, kind: ArtifactKind): Promise<T | null> {
  const supabase = createServiceClient();

  const { data } = await supabase
    .from("generation_artifacts")
    .select("payload")
    .eq("project_id", projectId)
    .eq("kind", kind)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (data?.payload as T) ?? null;
}
