import "server-only";

import { createServiceClient } from "@/lib/supabase/server";

/**
 * Reserving credits around a model call.
 *
 * The old shape was `has_credits()` then, on success, a charge — a read with no
 * lock, and nothing at all recorded when the call failed. So two requests could
 * both pass the check, and a failing prompt cost the user nothing while costing
 * the platform every token it burned.
 *
 * A reservation is held against the balance for the duration of the work and
 * then either settled at the real cost or released. Both outcomes are recorded,
 * which is the difference between a limit and a suggestion.
 *
 * Release is best-effort by design: a reservation that is never resolved
 * expires on its own, so a crash costs the user a temporary hold rather than a
 * permanent one.
 */
export interface Reservation {
  id: string;
  reserved: number;
}

export class OutOfCreditsError extends Error {
  constructor(readonly needed: number) {
    super("Not enough AI credits for this operation.");
    this.name = "OutOfCreditsError";
  }
}

export async function reserveCredits(params: {
  organizationId: string;
  needed: number;
  purpose: string;
  projectId?: string;
  actorUserId?: string;
}): Promise<Reservation> {
  const supabase = createServiceClient();

  const { data, error } = await supabase.rpc("reserve_credits", {
    p_organization_id: params.organizationId,
    p_needed: params.needed,
    p_purpose: params.purpose,
    p_project_id: params.projectId ?? null,
    p_actor: params.actorUserId ?? null,
  });

  if (error) {
    console.error("[credits:reserve]", error.message);
    throw new Error("Could not check your AI credit balance.");
  }

  // Null means the balance would not cover it — a refusal, not a failure.
  if (!data) throw new OutOfCreditsError(params.needed);

  return { id: data as string, reserved: params.needed };
}

/** The work succeeded. Charges what it actually cost. */
export async function settleCredits(reservationId: string, actual?: number): Promise<void> {
  const supabase = createServiceClient();

  const { error } = await supabase.rpc("settle_credit_reservation", {
    p_reservation_id: reservationId,
    p_actual: actual ?? null,
  });

  // Logged rather than thrown: the work is already done, and failing the
  // request now would report a success as an error. The reservation expires on
  // its own if this never lands, which under-charges rather than over-charges.
  if (error) console.error("[credits:settle]", reservationId, error.message);
}

/** The work failed. Gives the claim back without charging. */
export async function releaseCredits(reservationId: string, reason: string): Promise<void> {
  const supabase = createServiceClient();

  const { error } = await supabase.rpc("release_credit_reservation", {
    p_reservation_id: reservationId,
    p_reason: reason.slice(0, 200),
  });

  if (error) console.error("[credits:release]", reservationId, error.message);
}

/**
 * Runs `work` with credits held against it.
 *
 * The whole point is that there is exactly one path in and one path out: a
 * caller cannot reserve and then forget to settle, or settle twice, because it
 * never sees the reservation id.
 */
export async function withCredits<T>(
  params: {
    organizationId: string;
    needed: number;
    purpose: string;
    projectId?: string;
    actorUserId?: string;
  },
  work: () => Promise<{ result: T; actualCredits?: number }>,
): Promise<T> {
  const reservation = await reserveCredits(params);

  try {
    const { result, actualCredits } = await work();
    await settleCredits(reservation.id, actualCredits);
    return result;
  } catch (error) {
    await releaseCredits(
      reservation.id,
      error instanceof Error ? error.message : "the operation failed",
    );
    throw error;
  }
}

/**
 * Rate limit for one bucket.
 *
 * Counted in Postgres rather than in memory: this runs serverless, so an
 * in-process counter is per-instance and the instance count is not ours to
 * control.
 */
export interface RateLimitVerdict {
  allowed: boolean;
  hits: number;
  retryAfterSeconds: number;
}

export async function checkRateLimit(
  bucket: string,
  limit: number,
  windowSeconds = 60,
): Promise<RateLimitVerdict> {
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .rpc("check_rate_limit", {
      p_bucket: bucket,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    })
    .maybeSingle<{ allowed: boolean; hits: number; retry_after_seconds: number }>();

  if (error || !data) {
    // Fail open, deliberately. A limiter that blocks everything when its own
    // storage is unavailable converts a small outage into a total one, and the
    // credit reservation above is the control that actually bounds spend.
    console.error("[rate-limit]", bucket, error?.message);
    return { allowed: true, hits: 0, retryAfterSeconds: 0 };
  }

  return {
    allowed: data.allowed,
    hits: data.hits,
    retryAfterSeconds: data.retry_after_seconds,
  };
}

/** Limits per operation. Generous for a person, ruinous for a loop. */
export const RATE_LIMITS = {
  /** One build-order step. A generation issues these back to back. */
  generate: { limit: 40, windowSeconds: 60 },
  /** Whole-project planning, which is two model calls. */
  plan: { limit: 6, windowSeconds: 60 },
  /** The refinement assistant, used conversationally. */
  assistant: { limit: 20, windowSeconds: 60 },
  /** Importing, which costs a Figma call and possibly a vision call. */
  import: { limit: 10, windowSeconds: 60 },
} as const;
