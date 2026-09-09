import { NextResponse, type NextRequest } from "next/server";
import { deriveEventId, handleWebhook, type WebhookPayload } from "@/lib/payments/webhook-handler";
import { isFreshDelivery, verifyWebhookSignature } from "@/lib/payments/verify";

/**
 * Razorpay webhook.
 *
 * The one endpoint that grants paid entitlements, so it is deliberately strict:
 * verify, then bound the replay window, then process exactly once.
 *
 * Node runtime, not Edge: signature verification needs node:crypto.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) {
    // 500, not 400: this is our misconfiguration, and Razorpay should retry
    // once we have fixed it rather than give up.
    return NextResponse.json({ error: "not_configured" }, { status: 500 });
  }

  // Raw text, never request.json(). Parsing and re-serialising changes key
  // order and whitespace, and the signature would never match again.
  const rawBody = await request.text();
  const signature = request.headers.get("x-razorpay-signature");

  if (!verifyWebhookSignature({ rawBody, signature, webhookSecret: secret })) {
    // No detail: a precise message tells someone probing how close they are.
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  let payload: WebhookPayload;
  try {
    payload = JSON.parse(rawBody) as WebhookPayload;
  } catch {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  // A valid signature is valid forever, so a captured request could otherwise
  // be replayed indefinitely.
  if (!isFreshDelivery(payload.created_at)) {
    return NextResponse.json({ error: "stale_delivery" }, { status: 400 });
  }

  const eventId = deriveEventId(request.headers.get("x-razorpay-event-id"), payload);
  if (!eventId) {
    return NextResponse.json({ error: "unidentifiable_event" }, { status: 400 });
  }

  const outcome = await handleWebhook(payload, eventId);

  // A failure returns 500 so Razorpay retries; the event ledger makes that safe.
  if (!outcome.handled) {
    return NextResponse.json({ error: outcome.reason }, { status: 500 });
  }

  return NextResponse.json({ received: true, duplicate: outcome.duplicate });
}
