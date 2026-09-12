import "server-only";

import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Session } from "@/lib/auth/session";

/**
 * Reading the credit balance.
 *
 * Migration 0020 added reservations — credits held against the balance while a
 * generation runs, so two requests cannot both spend the same remainder — and
 * `my_credit_balance` was rewritten to net them off. Nothing called it. Every
 * screen went on summing `usage_records` itself, which counts what has been
 * *charged* and knows nothing about what is currently *held*.
 *
 * The visible consequence: mid-generation, a user sees the balance they had
 * before it started, begins a second generation on the strength of it, and is
 * refused with no way to tell why. The number on screen disagreed with the
 * number the database was enforcing.
 *
 * Computed in Postgres, under the caller's JWT, from usage_records and live
 * reservations. Never from anything a client supplied.
 */
export interface CreditBalance {
  /** Charged this month. */
  used: number;
  limit: number;
  /** Held by generations in flight — charged if they succeed, returned if not. */
  held: number;
  /** What a new request can actually claim. */
  remaining: number;
  percentUsed: number;
  /** When the monthly window rolls over. */
  resetsAt: string;
}

/** The first of next month, which is when the usage window resets. */
export function creditsResetAt(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth() + 1, 1);
}

export const getCreditBalance = cache(async (session: Session): Promise<CreditBalance> => {
  const limit = session.organization.ai_credits_limit;
  const empty: CreditBalance = {
    used: 0, limit, held: 0, remaining: limit, percentUsed: 0,
    resetsAt: creditsResetAt().toISOString(),
  };

  if (session.demo) return empty;

  const supabase = await createClient();
  if (!supabase) return empty;

  const { data, error } = await supabase.rpc("my_credit_balance", {
    p_organization_id: session.organization.id,
  });

  // The function lives in migration 0020. On a database that has not had it
  // applied the call fails, and returning `empty` would report a full balance
  // to someone who has spent theirs — wrong in the direction that lets them
  // start work the database will then refuse. Summing usage_records is the old
  // behaviour: it cannot see holds, but it cannot invent credits either.
  if (error || !data || data.length === 0) {
    if (error) console.error("[credits] my_credit_balance unavailable", error.message);
    return chargedOnly(supabase, session, limit);
  }

  const row = data[0] as { used: number; limit: number; remaining: number };
  const used = Number(row.used ?? 0);
  const reportedLimit = Number(row.limit ?? limit);
  const remaining = Number(row.remaining ?? 0);

  // `remaining` is limit - used - held, so held is what the difference leaves.
  // Derived rather than queried again: two round trips that could disagree is
  // worse than one that cannot.
  const held = Math.max(0, reportedLimit - used - remaining);

  return {
    used,
    limit: reportedLimit,
    held,
    remaining,
    percentUsed: reportedLimit > 0 ? Math.min(100, Math.round((used / reportedLimit) * 100)) : 0,
    resetsAt: creditsResetAt().toISOString(),
  };
});

/**
 * Charged credits, without holds.
 *
 * The fallback when `my_credit_balance` is not there. Reports `held: 0`
 * honestly rather than guessing, so the UI shows no hold rather than a wrong
 * one.
 */
async function chargedOnly(
  supabase: NonNullable<Awaited<ReturnType<typeof createClient>>>,
  session: Session,
  limit: number,
): Promise<CreditBalance> {
  const since = new Date();
  since.setDate(1);
  since.setHours(0, 0, 0, 0);

  const { data } = await supabase
    .from("usage_records")
    .select("quantity")
    .eq("organization_id", session.organization.id)
    .eq("metric", "ai_credits")
    .gte("occurred_at", since.toISOString())
    .overrideTypes<{ quantity: number }[]>();

  const used = (data ?? []).reduce((total, row) => total + Number(row.quantity ?? 0), 0);

  return {
    used,
    limit,
    held: 0,
    remaining: Math.max(0, limit - used),
    percentUsed: limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0,
    resetsAt: creditsResetAt().toISOString(),
  };
}

export interface CreditActivity {
  id: string;
  /** Which agent spent it — design_analyst, code_generator, refinement_assistant. */
  agent: string;
  purpose: string;
  modelKey: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number | null;
  status: string;
  projectName: string | null;
  createdAt: string;
}

/**
 * Where the credits went.
 *
 * From `model_runs`, which records every call this platform has ever made —
 * including the failed ones, because a user asking "what did I spend that on"
 * is often asking about a run that did not finish.
 */
export async function listCreditActivity(
  session: Session,
  limit = 50,
): Promise<CreditActivity[]> {
  if (session.demo) return [];

  const supabase = await createClient();
  if (!supabase) return [];

  const { data } = await supabase
    .from("model_runs")
    .select("id, agent, purpose, model_key, input_tokens, output_tokens, cost_usd, latency_ms, status, created_at, projects(name)")
    .eq("organization_id", session.organization.id)
    .order("created_at", { ascending: false })
    .limit(limit)
    .overrideTypes<{
      id: string; agent: string | null; purpose: string; model_key: string;
      input_tokens: number; output_tokens: number; cost_usd: number;
      latency_ms: number | null; status: string; created_at: string;
      projects: { name: string } | null;
    }[]>();

  return (data ?? []).map((row) => ({
    id: row.id,
    agent: row.agent ?? row.purpose,
    purpose: row.purpose,
    modelKey: row.model_key,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    costUsd: Number(row.cost_usd ?? 0),
    latencyMs: row.latency_ms,
    status: row.status,
    projectName: row.projects?.name ?? null,
    createdAt: row.created_at,
  }));
}

export interface CreditHold {
  id: string;
  reserved: number;
  purpose: string;
  createdAt: string;
  expiresAt: string;
}

/**
 * What is held right now.
 *
 * Shown because an unexplained gap between "used" and "remaining" reads as a
 * bug. A hold belonging to a crashed run expires on its own after thirty
 * minutes; until then it is genuinely unavailable, and saying so is better than
 * leaving the user to work it out.
 */
export async function listCreditHolds(session: Session): Promise<CreditHold[]> {
  if (session.demo) return [];

  const supabase = await createClient();
  if (!supabase) return [];

  const { data } = await supabase
    .from("credit_reservations")
    .select("id, reserved, purpose, created_at, expires_at")
    .eq("organization_id", session.organization.id)
    .eq("status", "held")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(20)
    .overrideTypes<{
      id: string; reserved: number; purpose: string; created_at: string; expires_at: string;
    }[]>();

  return (data ?? []).map((row) => ({
    id: row.id,
    reserved: Number(row.reserved),
    purpose: row.purpose,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  }));
}

/** Charged credits per day this month, for the usage chart. */
export async function creditsByDay(session: Session): Promise<{ day: string; credits: number }[]> {
  if (session.demo) return [];

  const supabase = await createClient();
  if (!supabase) return [];

  const since = new Date();
  since.setDate(1);
  since.setHours(0, 0, 0, 0);

  const { data } = await supabase
    .from("usage_records")
    .select("quantity, occurred_at")
    .eq("organization_id", session.organization.id)
    .eq("metric", "ai_credits")
    .gte("occurred_at", since.toISOString())
    .order("occurred_at")
    .overrideTypes<{ quantity: number; occurred_at: string }[]>();

  const byDay = new Map<string, number>();
  for (const row of data ?? []) {
    const day = row.occurred_at.slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + Number(row.quantity));
  }

  return [...byDay.entries()].map(([day, credits]) => ({ day, credits }));
}

/**
 * How an agent name reads on screen.
 *
 * The stored values are the pipeline's own vocabulary; this is the only place
 * that has to know they are not English.
 */
export const AGENT_LABEL: Record<string, string> = {
  design_analyst: "Design analysis",
  architecture_planner: "Architecture planning",
  component_planner: "Component planning",
  code_generator: "Code generation",
  refinement_assistant: "Assistant",
  visual_comparer: "Visual comparison",
};

export function agentLabel(agent: string): string {
  return AGENT_LABEL[agent] ?? agent.replace(/_/g, " ");
}
