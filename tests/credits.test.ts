import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Credits are reserved, then settled or released.
 *
 * The previous shape was an unlocked `has_credits` read followed by a charge
 * that only happened on success. Two requests could both pass the check, and a
 * failed call — tokens already spent at the provider — cost the user nothing.
 */
const calls: { name: string; payload: Record<string, unknown> }[] = [];
let reserveResult: string | null = "reservation-1";
let reserveError: { message: string } | null = null;
let rateLimitRow: { allowed: boolean; hits: number; retry_after_seconds: number } | null = {
  allowed: true, hits: 1, retry_after_seconds: 0,
};
let rateLimitError: { message: string } | null = null;

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => ({
    rpc: (name: string, payload: Record<string, unknown>) => {
      calls.push({ name, payload });

      if (name === "reserve_credits") {
        return Promise.resolve({ data: reserveResult, error: reserveError });
      }
      if (name === "check_rate_limit") {
        return {
          maybeSingle: () => Promise.resolve({ data: rateLimitRow, error: rateLimitError }),
        };
      }
      return Promise.resolve({ data: null, error: null });
    },
  }),
}));

const { OutOfCreditsError, checkRateLimit, releaseCredits, reserveCredits, settleCredits, withCredits } =
  await import("@/lib/ai/credits");

beforeEach(() => {
  calls.length = 0;
  reserveResult = "reservation-1";
  reserveError = null;
  rateLimitRow = { allowed: true, hits: 1, retry_after_seconds: 0 };
  rateLimitError = null;
});

const ORG = "11111111-1111-4111-8111-111111111111";

function callsTo(name: string) {
  return calls.filter((call) => call.name === name);
}

describe("reserving credits", () => {
  it("holds the requested amount against the workspace", async () => {
    const reservation = await reserveCredits({ organizationId: ORG, needed: 3, purpose: "codegen" });

    expect(reservation).toEqual({ id: "reservation-1", reserved: 3 });
    expect(callsTo("reserve_credits")[0].payload).toMatchObject({
      p_organization_id: ORG,
      p_needed: 3,
      p_purpose: "codegen",
    });
  });

  /** A null return is a refusal, not a failure — the balance would not cover it. */
  it("reports an insufficient balance distinctly", async () => {
    reserveResult = null;
    await expect(reserveCredits({ organizationId: ORG, needed: 99, purpose: "codegen" })).rejects.toThrow(
      OutOfCreditsError,
    );
  });

  it("does not report a database fault as being out of credits", async () => {
    reserveError = { message: "connection reset" };
    const failure = reserveCredits({ organizationId: ORG, needed: 1, purpose: "codegen" });

    await expect(failure).rejects.toThrow(/balance/i);
    await expect(failure).rejects.not.toThrow(OutOfCreditsError);
  });
});

describe("withCredits", () => {
  it("settles at the actual cost when the work succeeds", async () => {
    const result = await withCredits({ organizationId: ORG, needed: 5, purpose: "codegen" }, async () => ({
      result: "done",
      actualCredits: 2,
    }));

    expect(result).toBe("done");
    expect(callsTo("settle_credit_reservation")[0].payload).toMatchObject({
      p_reservation_id: "reservation-1",
      p_actual: 2,
    });
    expect(callsTo("release_credit_reservation")).toHaveLength(0);
  });

  /**
   * The reason the reservation exists: the tokens were spent, but the user
   * asked for an answer they never got.
   */
  it("releases the claim when the work throws, and does not charge", async () => {
    await expect(
      withCredits({ organizationId: ORG, needed: 5, purpose: "codegen" }, async () => {
        throw new Error("provider refused");
      }),
    ).rejects.toThrow("provider refused");

    expect(callsTo("settle_credit_reservation")).toHaveLength(0);
    expect(callsTo("release_credit_reservation")[0].payload).toMatchObject({
      p_reservation_id: "reservation-1",
    });
  });

  it("carries the original failure rather than masking it with a credit error", async () => {
    await expect(
      withCredits({ organizationId: ORG, needed: 1, purpose: "codegen" }, async () => {
        throw new TypeError("fetch failed");
      }),
    ).rejects.toThrow(TypeError);
  });

  it("never runs the work when there are not enough credits", async () => {
    reserveResult = null;
    const work = vi.fn();

    await expect(
      withCredits({ organizationId: ORG, needed: 1, purpose: "codegen" }, async () => {
        work();
        return { result: null };
      }),
    ).rejects.toThrow(OutOfCreditsError);

    expect(work).not.toHaveBeenCalled();
  });
});

describe("rate limiting", () => {
  it("passes the bucket and window through", async () => {
    await checkRateLimit("generate:org", 40, 60);
    expect(callsTo("check_rate_limit")[0].payload).toMatchObject({
      p_bucket: "generate:org",
      p_limit: 40,
      p_window_seconds: 60,
    });
  });

  it("reports a refusal with how long to wait", async () => {
    rateLimitRow = { allowed: false, hits: 41, retry_after_seconds: 37 };
    expect(await checkRateLimit("generate:org", 40)).toEqual({
      allowed: false, hits: 41, retryAfterSeconds: 37,
    });
  });

  /**
   * Fails open on purpose. A limiter that blocks everything when its own
   * storage is unavailable turns a small outage into a total one, and the
   * credit reservation is what actually bounds spend.
   */
  it("allows the request when the limiter itself is broken", async () => {
    rateLimitError = { message: "relation does not exist" };
    rateLimitRow = null;

    expect((await checkRateLimit("generate:org", 40)).allowed).toBe(true);
  });
});

describe("settle and release", () => {
  it("does not throw when settling fails, since the work is already done", async () => {
    await expect(settleCredits("reservation-1", 3)).resolves.toBeUndefined();
  });

  it("does not throw when releasing fails, since the reservation expires anyway", async () => {
    await expect(releaseCredits("reservation-1", "failed")).resolves.toBeUndefined();
  });
});
