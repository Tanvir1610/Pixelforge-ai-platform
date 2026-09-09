import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  hmacSha256Hex, isFreshDelivery, safeEqual, verifyCheckoutSignature, verifyWebhookSignature,
} from "@/lib/payments/verify";
import { deriveEventId, organizationFromPayload, planFromPayload } from "@/lib/payments/webhook-handler";
import { formatAmount, isPaidPlan, isUpgrade, PLANS } from "@/lib/payments/plans";
import { mapPaymentStatus, RazorpayClient, RazorpayError } from "@/lib/payments/razorpay";

const KEY_SECRET = "test_key_secret";
const WEBHOOK_SECRET = "test_webhook_secret";

function sign(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload, "utf8").digest("hex");
}

describe("safeEqual", () => {
  it("compares equal strings", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
  });

  it("rejects different strings and lengths without throwing", () => {
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("", "a")).toBe(false);
  });
});

describe("checkout signature", () => {
  const orderId = "order_ABC123";
  const paymentId = "pay_XYZ789";

  it("accepts a correctly signed callback", () => {
    const signature = sign(`${orderId}|${paymentId}`, KEY_SECRET);
    expect(verifyCheckoutSignature({ orderId, paymentId, signature, keySecret: KEY_SECRET })).toBe(true);
  });

  it("rejects a forged signature", () => {
    expect(
      verifyCheckoutSignature({ orderId, paymentId, signature: "f".repeat(64), keySecret: KEY_SECRET }),
    ).toBe(false);
  });

  /** Otherwise a user could pay for one order and claim another. */
  it("rejects a signature made for a different order", () => {
    const signature = sign(`order_OTHER|${paymentId}`, KEY_SECRET);
    expect(verifyCheckoutSignature({ orderId, paymentId, signature, keySecret: KEY_SECRET })).toBe(false);
  });

  it("rejects a signature made with the wrong secret", () => {
    const signature = sign(`${orderId}|${paymentId}`, "attacker_secret");
    expect(verifyCheckoutSignature({ orderId, paymentId, signature, keySecret: KEY_SECRET })).toBe(false);
  });

  it("rejects empty inputs rather than treating them as a match", () => {
    expect(verifyCheckoutSignature({ orderId: "", paymentId, signature: "x", keySecret: KEY_SECRET })).toBe(false);
    expect(verifyCheckoutSignature({ orderId, paymentId, signature: "", keySecret: KEY_SECRET })).toBe(false);
    expect(verifyCheckoutSignature({ orderId, paymentId, signature: "x", keySecret: "" })).toBe(false);
  });
});

describe("webhook signature", () => {
  const rawBody = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: "pay_1" } } } });

  it("accepts a correctly signed body", () => {
    expect(
      verifyWebhookSignature({ rawBody, signature: sign(rawBody, WEBHOOK_SECRET), webhookSecret: WEBHOOK_SECRET }),
    ).toBe(true);
  });

  it("rejects a missing signature header", () => {
    expect(verifyWebhookSignature({ rawBody, signature: null, webhookSecret: WEBHOOK_SECRET })).toBe(false);
  });

  /**
   * The single most common way webhook verification is broken: parsing and
   * re-serialising changes key order and whitespace, so the HMAC no longer
   * matches the bytes that were signed.
   */
  it("fails when the body was re-serialised rather than kept raw", () => {
    const signature = sign(rawBody, WEBHOOK_SECRET);
    const reserialised = JSON.stringify(JSON.parse(rawBody), null, 2);

    expect(verifyWebhookSignature({ rawBody: reserialised, signature, webhookSecret: WEBHOOK_SECRET })).toBe(false);
    expect(verifyWebhookSignature({ rawBody, signature, webhookSecret: WEBHOOK_SECRET })).toBe(true);
  });

  it("rejects a body altered after signing", () => {
    const signature = sign(rawBody, WEBHOOK_SECRET);
    const tampered = rawBody.replace("pay_1", "pay_2");
    expect(verifyWebhookSignature({ rawBody: tampered, signature, webhookSecret: WEBHOOK_SECRET })).toBe(false);
  });

  it("produces a stable hex digest", () => {
    expect(hmacSha256Hex("abc", "secret")).toHaveLength(64);
    expect(hmacSha256Hex("abc", "secret")).toBe(hmacSha256Hex("abc", "secret"));
    expect(hmacSha256Hex("abc", "secret")).not.toBe(hmacSha256Hex("abc", "secret2"));
  });
});

describe("replay window", () => {
  const now = new Date("2026-01-01T12:00:00Z").getTime();

  it("accepts a recent delivery", () => {
    expect(isFreshDelivery(now / 1000 - 60, 300, now)).toBe(true);
  });

  /** A valid signature is valid forever; without this a captured request could
   *  be replayed indefinitely. */
  it("rejects an old delivery", () => {
    expect(isFreshDelivery(now / 1000 - 3600, 300, now)).toBe(false);
  });

  it("rejects a timestamp far in the future", () => {
    expect(isFreshDelivery(now / 1000 + 3600, 300, now)).toBe(false);
  });

  it("accepts when the gateway sent no timestamp", () => {
    expect(isFreshDelivery(undefined, 300, now)).toBe(true);
  });

  it("rejects a non-numeric timestamp", () => {
    expect(isFreshDelivery(Number.NaN, 300, now)).toBe(false);
  });
});

describe("event identity", () => {
  const payload = {
    event: "payment.captured",
    payload: { payment: { entity: { id: "pay_1", notes: { organization_id: "org_1", plan_key: "pro" } } } },
  };

  it("prefers the gateway's event id header", () => {
    expect(deriveEventId("evt_123", payload)).toBe("evt_123");
  });

  /** A random fallback would make every retry look new — the exact bug the
   *  ledger exists to prevent. */
  it("derives a stable id when the header is absent", () => {
    expect(deriveEventId(null, payload)).toBe("payment.captured:pay_1");
    expect(deriveEventId(null, payload)).toBe(deriveEventId(null, payload));
  });

  it("returns nothing when the event cannot be identified", () => {
    expect(deriveEventId(null, { event: "payment.captured" })).toBeNull();
  });

  it("reads our own notes for attribution", () => {
    expect(organizationFromPayload(payload)).toBe("org_1");
    expect(planFromPayload(payload)).toBe("pro");
  });

  it("refuses a plan key it does not recognise", () => {
    expect(
      planFromPayload({
        event: "payment.captured",
        payload: { payment: { entity: { notes: { plan_key: "enterprise_unlimited" } } } },
      }),
    ).toBeNull();
  });
});

describe("payment status mapping", () => {
  it("maps the gateway's states", () => {
    expect(mapPaymentStatus("captured")).toBe("captured");
    expect(mapPaymentStatus("authorized")).toBe("authorized");
    expect(mapPaymentStatus("failed")).toBe("failed");
  });

  it("distinguishes a full refund from a partial one", () => {
    expect(mapPaymentStatus("captured", 100, 100)).toBe("refunded");
    expect(mapPaymentStatus("captured", 40, 100)).toBe("partially_refunded");
  });

  /** An unrecognised state must never read as paid. */
  it("treats an unknown state as unpaid", () => {
    expect(mapPaymentStatus("something_new")).toBe("created");
  });
});

describe("plans", () => {
  it("stores amounts in minor units", () => {
    expect(PLANS.pro.amountMinor).toBe(249_900);
    expect(Number.isInteger(PLANS.pro.amountMinor)).toBe(true);
    expect(Number.isInteger(PLANS.team.amountMinor)).toBe(true);
  });

  it("knows which plans are paid", () => {
    expect(isPaidPlan("pro")).toBe(true);
    expect(isPaidPlan("free")).toBe(false);
    expect(isPaidPlan("nonsense")).toBe(false);
  });

  /** Downgrades wait for period end; cutting entitlements already paid for is
   *  theft even if it is only a few days of it. */
  it("distinguishes upgrades from downgrades", () => {
    expect(isUpgrade("free", "pro")).toBe(true);
    expect(isUpgrade("pro", "team")).toBe(true);
    expect(isUpgrade("team", "pro")).toBe(false);
    expect(isUpgrade("pro", "pro")).toBe(false);
  });

  it("formats without misstating a price", () => {
    expect(formatAmount(249_900)).toContain("2,499");
    expect(formatAmount(0)).toContain("0");
  });
});

describe("Razorpay client", () => {
  function jsonResponse(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }

  /** A browser-supplied amount is a browser-supplied price. */
  it("takes the amount from the catalogue, never from the caller", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ id: "order_1", amount: 249900, currency: "INR", status: "created" }));
    const client = new RazorpayClient({ keyId: "rzp_test_x", keySecret: "s", fetchImpl: fetchImpl as never });

    await client.createOrder({ planKey: "pro", organizationId: "org_1", receipt: "rcpt_1" });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.razorpay.com/v1/orders");

    const body = JSON.parse(init.body as string);
    expect(body.amount).toBe(PLANS.pro.amountMinor);
    expect(body.currency).toBe("INR");
    expect(body.payment_capture).toBe(1);
    // Our own attribution travels with the order.
    expect(body.notes).toEqual({ organization_id: "org_1", plan_key: "pro" });
  });

  it("authenticates with HTTP Basic", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ id: "order_1" }));
    const client = new RazorpayClient({ keyId: "rzp_test_x", keySecret: "s", fetchImpl: fetchImpl as never });

    await client.createOrder({ planKey: "pro", organizationId: "org_1", receipt: "r" });

    const header = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>;
    expect(header.Authorization).toBe(`Basic ${Buffer.from("rzp_test_x:s").toString("base64")}`);
  });

  it("classifies gateway errors without leaking their wording", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: { code: "BAD_REQUEST_ERROR", description: "internal field xyz invalid" } }, 400),
    );
    const client = new RazorpayClient({ keyId: "k", keySecret: "s", fetchImpl: fetchImpl as never });

    const error = await client.createOrder({ planKey: "pro", organizationId: "o", receipt: "r" })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(RazorpayError);
    expect((error as RazorpayError).code).toBe("invalid_request");
    expect((error as RazorpayError).message).not.toContain("xyz");
  });

  /** Retrying a charge could take the money twice. */
  it("never retries order creation", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 500));
    const client = new RazorpayClient({ keyId: "k", keySecret: "s", fetchImpl: fetchImpl as never });

    await expect(client.createOrder({ planKey: "pro", organizationId: "o", receipt: "r" })).rejects.toBeInstanceOf(
      RazorpayError,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries an idempotent read", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      return calls === 1 ? jsonResponse({}, 503) : jsonResponse({ id: "pay_1", status: "captured", amount: 100 });
    });
    const client = new RazorpayClient({ keyId: "k", keySecret: "s", fetchImpl: fetchImpl as never });

    await expect(client.getPayment("pay_1")).resolves.toMatchObject({ id: "pay_1" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  }, 15_000);
});
