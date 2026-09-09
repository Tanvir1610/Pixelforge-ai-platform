import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Razorpay signature verification.
 *
 * This is the boundary between "a browser told us it paid" and "the gateway
 * proved it". Everything downstream — credits, plan limits, whether an
 * organization can generate code — depends on this function being right, so it
 * is pure and heavily tested.
 *
 * Two distinct signatures, with different payloads and different secrets:
 *
 * - **Checkout**: HMAC of `order_id|payment_id` with the API *key secret*.
 * - **Webhook**: HMAC of the exact raw request body with the *webhook secret*.
 */

/**
 * Constant-time comparison.
 *
 * `===` on a hex string leaks how many leading characters matched, which is
 * enough to forge a signature byte by byte given enough attempts. Length is
 * compared first because timingSafeEqual throws on a mismatch — that leaks
 * length only, which a signature scheme with a fixed digest size does anyway.
 */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function hmacSha256Hex(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload, "utf8").digest("hex");
}

export interface CheckoutSignatureInput {
  orderId: string;
  paymentId: string;
  signature: string;
  keySecret: string;
}

/**
 * Verifies the signature Checkout hands back to the browser.
 *
 * Useful for showing an immediate success screen. It is deliberately NOT what
 * grants entitlements — a determined user controls their own browser, and the
 * webhook is the evidence that money actually moved.
 */
export function verifyCheckoutSignature(input: CheckoutSignatureInput): boolean {
  if (!input.orderId || !input.paymentId || !input.signature || !input.keySecret) return false;
  const expected = hmacSha256Hex(`${input.orderId}|${input.paymentId}`, input.keySecret);
  return safeEqual(expected, input.signature);
}

export interface WebhookVerificationInput {
  /**
   * The exact bytes received. Parsing and re-serialising JSON changes key order
   * and whitespace, and the signature will never match again — this is the most
   * common way webhook verification is broken.
   */
  rawBody: string;
  signature: string | null;
  webhookSecret: string;
}

export function verifyWebhookSignature(input: WebhookVerificationInput): boolean {
  if (!input.rawBody || !input.signature || !input.webhookSecret) return false;
  const expected = hmacSha256Hex(input.rawBody, input.webhookSecret);
  return safeEqual(expected, input.signature);
}

/**
 * Rejects deliveries that are too old to be genuine.
 *
 * A valid signature is forever valid, so a captured request can be replayed
 * indefinitely. The event-id ledger already stops a *duplicate* being processed
 * twice; this additionally bounds the window in which a captured request is
 * worth anything at all.
 */
export function isFreshDelivery(
  createdAtSeconds: number | undefined,
  toleranceSeconds = 300,
  now = Date.now(),
): boolean {
  if (createdAtSeconds === undefined) return true;
  if (!Number.isFinite(createdAtSeconds)) return false;
  const ageSeconds = Math.abs(now / 1000 - createdAtSeconds);
  return ageSeconds <= toleranceSeconds;
}
