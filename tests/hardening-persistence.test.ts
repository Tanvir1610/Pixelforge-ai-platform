import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regressions for the hardening pass that cross the database boundary.
 *
 * The Supabase client is faked rather than mocked per-call: each of these
 * defects was about *which* statement ran and in what order, so the fake records
 * the calls and the assertions read them back.
 */

interface RecordedCall {
  kind: "rpc" | "select" | "upsert" | "update" | "insert" | "upload" | "signedUrls";
  name: string;
  payload?: unknown;
  filters?: Record<string, unknown>;
}

const calls: RecordedCall[] = [];
/** Rows the fake returns for `.maybeSingle()`, keyed by table. */
const rows = new Map<string, unknown>();

function table(name: string) {
  const filters: Record<string, unknown> = {};

  const builder = {
    select() {
      calls.push({ kind: "select", name, filters });
      return builder;
    },
    eq(column: string, value: unknown) {
      filters[column] = value;
      return builder;
    },
    async maybeSingle() {
      return { data: rows.get(name) ?? null, error: null };
    },
    async single() {
      return { data: rows.get(name) ?? null, error: null };
    },
    async upsert(payload: unknown) {
      calls.push({ kind: "upsert", name, payload });
      return { error: null };
    },
    async update(payload: unknown) {
      calls.push({ kind: "update", name, payload, filters });
      return { error: null, ...builder };
    },
    async insert(payload: unknown) {
      calls.push({ kind: "insert", name, payload });
      return { error: null };
    },
  };

  // `update` is used both awaited and chained with .eq(); support both.
  const chainableUpdate = (payload: unknown) => {
    calls.push({ kind: "update", name, payload, filters });
    return {
      eq(column: string, value: unknown) {
        filters[column] = value;
        return chainableUpdate.thenable;
      },
      then: (resolve: (value: unknown) => void) => resolve({ error: null }),
    };
  };
  chainableUpdate.thenable = {
    eq(column: string, value: unknown) {
      filters[column] = value;
      return chainableUpdate.thenable;
    },
    then: (resolve: (value: unknown) => void) => resolve({ error: null }),
  };
  builder.update = chainableUpdate as never;

  return builder;
}

const fakeClient = {
  from: (name: string) => table(name),
  rpc: async (name: string, payload: unknown) => {
    calls.push({ kind: "rpc", name, payload });
    if (name === "claim_webhook_event") return { data: true, error: null };
    return { data: null, error: null };
  },
  storage: {
    from: () => ({
      upload: async (path: string) => {
        calls.push({ kind: "upload", name: path });
        return { error: null };
      },
      createSignedUrls: async (paths: string[]) => {
        calls.push({ kind: "signedUrls", name: paths.join(",") });
        return { data: [], error: null };
      },
      createSignedUrl: async (path: string) => {
        calls.push({ kind: "signedUrls", name: path });
        return { data: { signedUrl: `https://signed.test/${path}` }, error: null };
      },
    }),
  },
};

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => fakeClient,
  createClient: async () => fakeClient,
}));

const { handleWebhook } = await import("@/lib/payments/webhook-handler");
const { writeVersion } = await import("@/lib/repositories/code");
const { getSignedUrl, getSignedUrls } = await import("@/lib/storage/signed-urls");

beforeEach(() => {
  calls.length = 0;
  rows.clear();
});

const PROJECT = "11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";
const ACTOR = "33333333-3333-4333-8333-333333333333";

function rpcCall(name: string) {
  return calls.find((call) => call.kind === "rpc" && call.name === name);
}

describe("refunds and entitlement", () => {
  const partialRefund = {
    event: "refund.processed",
    payload: {
      payment: { entity: { id: "pay_1", amount: 100_000, amount_refunded: 1_00, notes: { organization_id: ORG } } },
    },
  };

  /**
   * A ₹1 goodwill refund used to mark the payment fully `refunded` and cancel
   * the customer's plan outright.
   */
  it("does not cancel the plan on a partial refund", async () => {
    const outcome = await handleWebhook(partialRefund, "evt_partial");

    expect(outcome).toMatchObject({ handled: true, action: "partially_refunded" });
    expect(rpcCall("apply_subscription")).toBeUndefined();

    const update = calls.find((call) => call.kind === "update" && call.name === "payments");
    expect(update?.payload).toMatchObject({ status: "partially_refunded", amount_refunded_minor: 100 });
  });

  it("cancels the plan when the whole amount comes back", async () => {
    const outcome = await handleWebhook(
      {
        event: "refund.processed",
        payload: {
          payment: {
            entity: { id: "pay_2", amount: 100_000, amount_refunded: 100_000, notes: { organization_id: ORG } },
          },
        },
      },
      "evt_full",
    );

    expect(outcome).toMatchObject({ handled: true, action: "refunded" });
    expect(rpcCall("apply_subscription")?.payload).toMatchObject({ p_plan_key: "free", p_status: "canceled" });
  });
});

describe("out-of-order payment deliveries", () => {
  it("ignores an authorisation that arrives after the capture", async () => {
    rows.set("payments", { status: "captured" });

    const outcome = await handleWebhook(
      {
        event: "payment.authorized",
        payload: {
          payment: {
            entity: { id: "pay_3", amount: 100_000, status: "authorized", notes: { organization_id: ORG } },
          },
        },
      },
      "evt_late_auth",
    );

    expect(outcome).toMatchObject({ handled: true, action: "ignored_stale_authorized" });
    expect(calls.find((call) => call.kind === "upsert" && call.name === "payments")).toBeUndefined();
  });

  it("still records a capture over an authorisation", async () => {
    rows.set("payments", { status: "authorized" });

    const outcome = await handleWebhook(
      {
        event: "payment.captured",
        payload: {
          payment: {
            entity: { id: "pay_4", amount: 100_000, status: "captured", notes: { organization_id: ORG } },
          },
        },
      },
      "evt_capture",
    );

    expect(outcome).toMatchObject({ handled: true });
    expect(calls.find((call) => call.kind === "upsert" && call.name === "payments")?.payload)
      .toMatchObject({ status: "captured" });
  });
});

describe("webhook attribution", () => {
  /**
   * The notes are signature-covered but settable on a payment created outside
   * our checkout, and the plan key in them is a grant of entitlement. Our own
   * order row is the stronger evidence.
   */
  it("prefers our order record over the payload's notes", async () => {
    rows.set("payment_orders", { organization_id: "org-from-our-records", plan_key: "pro" });

    await handleWebhook(
      {
        event: "payment.captured",
        payload: {
          payment: {
            entity: {
              id: "pay_5",
              order_id: "order_1",
              amount: 100_000,
              status: "captured",
              notes: { organization_id: "org-from-the-payload", plan_key: "team" },
            },
          },
        },
      },
      "evt_attribution",
    );

    expect(rpcCall("apply_subscription")?.payload).toMatchObject({
      p_organization_id: "org-from-our-records",
      p_plan_key: "pro",
    });
  });
});

describe("writeVersion authorisation", () => {
  /**
   * `create_code_version` gates on can_write_project(), which reads auth.uid().
   * This runs under the service role, where that is null — so the call could
   * never succeed until the actor was passed explicitly.
   */
  it("passes the acting user to the database", async () => {
    rows.set("code_versions", { version_number: 1 });

    await writeVersion({
      projectId: PROJECT,
      actorUserId: ACTOR,
      files: [{ path: "src/index.ts", content: "export const x = 1;" }],
    }).catch(() => undefined);

    expect(rpcCall("create_code_version")?.payload).toMatchObject({
      p_project_id: PROJECT,
      p_actor_id: ACTOR,
    });
  });

  it("refuses to write a version with no actor at all", async () => {
    await expect(
      writeVersion({
        projectId: PROJECT,
        actorUserId: "",
        files: [{ path: "src/index.ts", content: "export const x = 1;" }],
      }),
    ).rejects.toThrow(/on behalf of/i);

    expect(rpcCall("create_code_version")).toBeUndefined();
  });
});

describe("signed URL paths", () => {
  it("requires a project id on the single-path variant", async () => {
    await expect(getSignedUrl("screenshots", "not-a-project/shot.png")).rejects.toThrow(/project id/i);
  });

  /**
   * The batched variant skipped this check entirely, so "every path must be
   * {project_id}/…" was an invariant a caller could step around by asking for
   * two URLs instead of one.
   */
  it("requires a project id on the batched variant too", async () => {
    await expect(getSignedUrls("screenshots", [`${PROJECT}/ok.png`, "../elsewhere.png"]))
      .rejects.toThrow(/project id/i);
  });

  it("still allows correctly scoped paths", async () => {
    await expect(getSignedUrls("screenshots", [`${PROJECT}/ok.png`])).resolves.toBeTypeOf("object");
  });

  it("exempts avatars, which are not project-scoped", async () => {
    await expect(getSignedUrl("avatars", "some-user.png")).resolves.toBeTypeOf("string");
  });
});
