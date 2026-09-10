import "server-only";

import { createServiceClient } from "@/lib/supabase/server";
import { mapPaymentStatus } from "./razorpay";
import type { PlanKey } from "./plans";

/**
 * Webhook processing.
 *
 * This is where entitlements are granted, so the ordering matters:
 *
 *   1. Claim the event id. A duplicate stops here, before anything is applied.
 *   2. Resolve the organization from OUR records, not from the payload alone.
 *   3. Apply, then mark processed.
 *
 * A gateway retries aggressively. Step 1 is what stops a retry granting a
 * second month of credits.
 */
export interface WebhookPayload {
  event: string;
  created_at?: number;
  payload?: {
    payment?: { entity?: RazorpayPaymentEntity };
    order?: { entity?: { id?: string; notes?: Record<string, string> } };
    subscription?: { entity?: RazorpaySubscriptionEntity };
  };
}

interface RazorpayPaymentEntity {
  id?: string;
  order_id?: string;
  amount?: number;
  amount_refunded?: number;
  currency?: string;
  status?: string;
  method?: string;
  error_description?: string;
  created_at?: number;
  notes?: Record<string, string>;
}

interface RazorpaySubscriptionEntity {
  id?: string;
  status?: string;
  current_start?: number;
  current_end?: number;
  notes?: Record<string, string>;
}

export type WebhookOutcome =
  | { handled: true; duplicate: false; action: string }
  | { handled: true; duplicate: true; action: "already_processed" }
  | { handled: false; reason: string };

/**
 * Derives the event id.
 *
 * Razorpay sends `x-razorpay-event-id`; when absent, the entity id plus event
 * type is a stable substitute. A random id would make every retry look new,
 * which is exactly the bug the ledger exists to prevent.
 */
export function deriveEventId(headerEventId: string | null, payload: WebhookPayload): string | null {
  if (headerEventId) return headerEventId;

  const entityId =
    payload.payload?.payment?.entity?.id ??
    payload.payload?.subscription?.entity?.id ??
    payload.payload?.order?.entity?.id;

  return entityId ? `${payload.event}:${entityId}` : null;
}

/** Reads our organization id from the notes we set when creating the order. */
export function organizationFromPayload(payload: WebhookPayload): string | null {
  return (
    payload.payload?.payment?.entity?.notes?.organization_id ??
    payload.payload?.subscription?.entity?.notes?.organization_id ??
    payload.payload?.order?.entity?.notes?.organization_id ??
    null
  );
}

export function planFromPayload(payload: WebhookPayload): PlanKey | null {
  const key =
    payload.payload?.payment?.entity?.notes?.plan_key ??
    payload.payload?.subscription?.entity?.notes?.plan_key;
  return key === "pro" || key === "team" || key === "free" ? key : null;
}

export function orderIdFromPayload(payload: WebhookPayload): string | null {
  return payload.payload?.payment?.entity?.order_id ?? payload.payload?.order?.entity?.id ?? null;
}

/**
 * Resolves who and what a payment is for, preferring our own order record.
 *
 * The notes are echoed back by the gateway and the signature covers them, so
 * they are not forgeable — but they are also settable on a payment created
 * outside our checkout (a payment link, or the dashboard), and a plan key is a
 * grant of entitlement. The order row we wrote when the checkout began is the
 * stronger evidence, so it wins; the notes remain the fallback for a payment
 * that legitimately has no order of ours behind it.
 */
export async function attribute(
  payload: WebhookPayload,
): Promise<{ organizationId: string | null; plan: PlanKey | null }> {
  const fromNotes = { organizationId: organizationFromPayload(payload), plan: planFromPayload(payload) };
  const orderId = orderIdFromPayload(payload);
  if (!orderId) return fromNotes;

  const supabase = createServiceClient();
  const { data } = await supabase
    .from("payment_orders")
    .select("organization_id, plan_key")
    .eq("provider_order_id", orderId)
    .maybeSingle<{ organization_id: string; plan_key: string | null }>();

  if (!data) return fromNotes;

  const plan = data.plan_key;
  return {
    organizationId: data.organization_id,
    plan: plan === "pro" || plan === "team" || plan === "free" ? plan : fromNotes.plan,
  };
}

/**
 * Payment states, ordered by how settled they are.
 *
 * Webhook deliveries are not ordered. A `payment.authorized` arriving after the
 * `payment.captured` it precedes used to overwrite the captured row and null out
 * captured_at, turning a paid customer back into an unpaid one.
 */
const STATUS_RANK: Record<string, number> = {
  created: 0,
  failed: 1,
  authorized: 2,
  captured: 3,
  partially_refunded: 4,
  refunded: 5,
};

export function isStatusRegression(current: string | null | undefined, incoming: string): boolean {
  if (!current) return false;
  return (STATUS_RANK[incoming] ?? 0) < (STATUS_RANK[current] ?? 0);
}

export async function handleWebhook(payload: WebhookPayload, eventId: string): Promise<WebhookOutcome> {
  const supabase = createServiceClient();
  const { organizationId, plan } = await attribute(payload);

  // Claimed first: a duplicate must not reach the handlers below.
  const { data: claimed } = await supabase.rpc("claim_webhook_event", {
    p_provider_event_id: eventId,
    p_event_type: payload.event,
    p_payload: payload as never,
    p_organization_id: organizationId,
  });

  if (claimed === false) {
    return { handled: true, duplicate: true, action: "already_processed" };
  }

  try {
    const action = await apply(payload, organizationId, plan);
    await supabase.rpc("complete_webhook_event", { p_provider_event_id: eventId, p_error: null });
    return { handled: true, duplicate: false, action };
  } catch (error) {
    // The event stays claimed with its error recorded. Re-processing a partial
    // application automatically is more dangerous than leaving it for a human.
    await supabase.rpc("complete_webhook_event", {
      p_provider_event_id: eventId,
      p_error: error instanceof Error ? error.message.slice(0, 300) : "unknown error",
    });
    return { handled: false, reason: "processing_failed" };
  }
}

async function apply(
  payload: WebhookPayload,
  organizationId: string | null,
  plan: PlanKey | null,
): Promise<string> {
  const supabase = createServiceClient();
  const payment = payload.payload?.payment?.entity;

  switch (payload.event) {
    case "payment.captured":
    case "payment.authorized":
    case "payment.failed": {
      if (!payment?.id || !organizationId) return "ignored_unattributable";

      const status = mapPaymentStatus(
        payment.status ?? "created",
        payment.amount_refunded ?? 0,
        payment.amount ?? 0,
      );

      // Deliveries are not ordered, so a late `authorized` must not undo the
      // `captured` that already landed.
      const { data: existing } = await supabase
        .from("payments")
        .select("status")
        .eq("provider", "razorpay")
        .eq("provider_payment_id", payment.id)
        .maybeSingle<{ status: string }>();

      if (isStatusRegression(existing?.status, status)) {
        return `ignored_stale_${status}`;
      }

      await supabase.from("payments").upsert(
        {
          organization_id: organizationId,
          provider: "razorpay",
          provider_payment_id: payment.id,
          amount_minor: payment.amount ?? 0,
          amount_refunded_minor: payment.amount_refunded ?? 0,
          currency: payment.currency ?? "INR",
          status: status as never,
          method: payment.method ?? null,
          failure_reason: payment.error_description ?? null,
          captured_at: status === "captured" ? new Date().toISOString() : null,
        },
        { onConflict: "provider,provider_payment_id" },
      );

      if (payment.order_id) {
        await supabase
          .from("payment_orders")
          .update({ status: status as never })
          .eq("provider_order_id", payment.order_id);
      }

      // Only a captured payment grants anything. Authorised means the money is
      // held, not taken.
      if (status === "captured" && plan) {
        const periodEnd = new Date();
        periodEnd.setMonth(periodEnd.getMonth() + 1);

        await supabase.rpc("apply_subscription", {
          p_organization_id: organizationId,
          p_plan_key: plan,
          p_status: "active",
          p_period_start: new Date().toISOString(),
          p_period_end: periodEnd.toISOString(),
        });
        return "subscription_activated";
      }

      return `payment_${status}`;
    }

    case "refund.created":
    case "refund.processed": {
      if (!payment?.id) return "ignored_no_payment";

      const refunded = payment.amount_refunded ?? payment.amount ?? 0;
      const charged = payment.amount ?? 0;
      // A ₹1 goodwill refund is not a cancellation. Only a refund of the whole
      // amount removes what the payment bought; anything less leaves the
      // entitlement in place and records the partial state.
      const full = charged > 0 ? refunded >= charged : true;

      await supabase
        .from("payments")
        .update({
          amount_refunded_minor: refunded,
          status: (full ? "refunded" : "partially_refunded") as never,
        })
        .eq("provider", "razorpay")
        .eq("provider_payment_id", payment.id);

      if (!full) return "partially_refunded";

      // A full refund removes the entitlement it paid for; leaving it would let
      // a customer refund and keep the plan.
      if (organizationId) {
        await supabase.rpc("apply_subscription", {
          p_organization_id: organizationId,
          p_plan_key: "free",
          p_status: "canceled",
        });
      }
      return "refunded";
    }

    case "subscription.activated":
    case "subscription.charged":
    case "subscription.halted":
    case "subscription.cancelled": {
      const subscription = payload.payload?.subscription?.entity;
      if (!subscription?.id || !organizationId) return "ignored_unattributable";

      const status =
        payload.event === "subscription.cancelled" ? "canceled"
        : payload.event === "subscription.halted" ? "past_due"
        : "active";

      await supabase.rpc("apply_subscription", {
        p_organization_id: organizationId,
        p_plan_key: status === "active" ? (plan ?? "free") : "free",
        p_status: status,
        p_provider_subscription_id: subscription.id,
        p_period_start: subscription.current_start
          ? new Date(subscription.current_start * 1000).toISOString()
          : null,
        p_period_end: subscription.current_end
          ? new Date(subscription.current_end * 1000).toISOString()
          : null,
      });

      return `subscription_${status}`;
    }

    default:
      // Unknown events are recorded and ignored rather than rejected: Razorpay
      // adds events, and a 4xx would make it retry something we will never
      // understand.
      return "ignored_unknown_event";
  }
}
