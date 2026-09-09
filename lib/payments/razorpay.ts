import "server-only";

import { PLANS, type PlanKey } from "./plans";

/**
 * Razorpay REST client.
 *
 * `fetch` is injectable so request shape and error handling are testable
 * without a network — which matters more here than anywhere else in the
 * platform, because a wrong field against a live key moves real money.
 */
export class RazorpayError extends Error {
  constructor(
    readonly code: "unauthorised" | "invalid_request" | "rate_limited" | "upstream",
    message: string,
    readonly providerCode?: string,
  ) {
    super(message);
    this.name = "RazorpayError";
  }
}

/** User-facing copy. Gateway text often names internal fields. */
export const RAZORPAY_ERROR_COPY: Record<RazorpayError["code"], string> = {
  unauthorised: "Payments aren't configured correctly. Contact support.",
  invalid_request: "That payment request was rejected. Check the amount and try again.",
  rate_limited: "Too many payment attempts. Wait a moment and try again.",
  upstream: "The payment provider didn't respond. No charge was made — try again.",
};

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  status: string;
  receipt?: string;
}

export interface RazorpayPayment {
  id: string;
  order_id?: string;
  amount: number;
  amount_refunded?: number;
  currency: string;
  status: string;
  method?: string;
  error_description?: string;
  captured?: boolean;
  created_at?: number;
}

export interface RazorpayClientOptions {
  keyId: string;
  keySecret: string;
  fetchImpl?: typeof fetch;
}

const API = "https://api.razorpay.com/v1";

export class RazorpayClient {
  private readonly auth: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: RazorpayClientOptions) {
    // Razorpay uses HTTP Basic with key_id as user and key_secret as password.
    this.auth = Buffer.from(`${options.keyId}:${options.keySecret}`).toString("base64");
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async request<T>(path: string, init: RequestInit & { retry?: boolean } = {}): Promise<T> {
    const { retry = false, ...rest } = init;
    const maxAttempts = retry ? 3 : 1;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const response = await this.fetchImpl(`${API}${path}`, {
        ...rest,
        headers: {
          Authorization: `Basic ${this.auth}`,
          "Content-Type": "application/json",
          ...(rest.headers ?? {}),
        },
      });

      if (response.ok) return (await response.json()) as T;

      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt === maxAttempts - 1) {
        const body = (await response.json().catch(() => ({}))) as {
          error?: { code?: string; description?: string };
        };
        const code =
          response.status === 401 ? "unauthorised"
          : response.status === 400 ? "invalid_request"
          : response.status === 429 ? "rate_limited"
          : "upstream";
        throw new RazorpayError(code, RAZORPAY_ERROR_COPY[code], body.error?.code);
      }

      await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 400));
    }

    throw new RazorpayError("upstream", RAZORPAY_ERROR_COPY.upstream);
  }

  /**
   * Creates an order.
   *
   * The amount comes from the plan catalogue, never from the client. A
   * browser-supplied amount is a browser-supplied price.
   *
   * `receipt` carries our own id so a webhook can be traced back even if the
   * order row was somehow not written.
   */
  async createOrder(params: {
    planKey: Exclude<PlanKey, "free">;
    organizationId: string;
    receipt: string;
  }): Promise<RazorpayOrder> {
    const plan = PLANS[params.planKey];

    return this.request<RazorpayOrder>("/orders", {
      method: "POST",
      body: JSON.stringify({
        amount: plan.amountMinor,
        currency: plan.currency,
        receipt: params.receipt,
        // Payment is captured by the gateway on authorisation, so there is no
        // window where a customer is charged but the money is never taken.
        payment_capture: 1,
        notes: {
          organization_id: params.organizationId,
          plan_key: params.planKey,
        },
      }),
    });
  }

  getPayment(paymentId: string): Promise<RazorpayPayment> {
    return this.request<RazorpayPayment>(`/payments/${encodeURIComponent(paymentId)}`, {
      method: "GET",
      retry: true,
    });
  }

  getOrder(orderId: string): Promise<RazorpayOrder> {
    return this.request<RazorpayOrder>(`/orders/${encodeURIComponent(orderId)}`, {
      method: "GET",
      retry: true,
    });
  }

  /** Amount omitted refunds in full. Minor units throughout. */
  async refund(paymentId: string, amountMinor?: number): Promise<{ id: string; status: string }> {
    return this.request(`/payments/${encodeURIComponent(paymentId)}/refund`, {
      method: "POST",
      body: JSON.stringify(amountMinor === undefined ? {} : { amount: amountMinor }),
    });
  }
}

/**
 * Builds a client from the environment.
 *
 * Credentials are never accepted as arguments from application code, so there
 * is exactly one place a key can enter the process.
 */
export function createRazorpayClient(fetchImpl?: typeof fetch): RazorpayClient {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    throw new RazorpayError("unauthorised", "Payments are not configured.");
  }

  return new RazorpayClient({ keyId, keySecret, fetchImpl });
}

/** Razorpay's payment states, mapped to ours. */
export function mapPaymentStatus(status: string, amountRefunded = 0, amount = 0): string {
  if (status === "captured" && amountRefunded > 0) {
    return amountRefunded >= amount ? "refunded" : "partially_refunded";
  }
  switch (status) {
    case "created": return "created";
    case "authorized": return "authorized";
    case "captured": return "captured";
    case "refunded": return "refunded";
    case "failed": return "failed";
    // An unknown state must not read as paid.
    default: return "created";
  }
}
