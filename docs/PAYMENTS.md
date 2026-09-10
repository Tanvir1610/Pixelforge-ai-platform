# Payments (Razorpay)

## Rotate the uploaded key first

A **live** `key_id` / `key_secret` pair was shared as a CSV. Treat it as
compromised: it can charge cards, issue refunds and read payment history.
Regenerate it in Dashboard → Account & Settings → API Keys, and set the new one
as an environment variable. It is not in this repository, and `.env*` is
gitignored.

## Three rules the design follows

**1. The webhook is the source of truth, not the browser.**
Checkout hands the browser a signature, and `verifyCheckoutSignature` validates
it — but only to show a success screen. Entitlements are granted solely by a
signed webhook, because a user controls their own browser and a gateway callback
is the only evidence money actually moved.

**2. Every gateway event is processed exactly once.**
`payment_webhook_events` is keyed by the gateway's event id, so a retry collides
and is rejected by the *database* rather than by application logic that might be
wrong. Razorpay retries aggressively; without this, one retry is a second month
of credits.

**3. Entitlements are derived, never set.**
`apply_subscription` reads the credit limit from `billing_plans`. No caller can
invent a limit, and changing a plan's credits updates every organization on it.

## Signature verification

Two signatures, different payloads and different secrets:

| | Payload | Secret |
| --- | --- | --- |
| Checkout | `order_id\|payment_id` | API key secret |
| Webhook | the **raw request body** | webhook secret |

The webhook route reads `request.text()`, never `request.json()`. Parsing and
re-serialising changes key order and whitespace, so the HMAC stops matching —
this is the single most common way webhook verification gets broken, and there
is a test asserting exactly that failure.

Comparison is `timingSafeEqual`. Using `===` on a hex digest leaks how many
leading characters matched, which is enough to forge a signature byte by byte.

A valid signature is valid forever, so `isFreshDelivery` bounds the replay
window to five minutes on top of the event-id ledger.

## Money handling

Amounts are integer **minor units** (paise) everywhere. Floats must never decide
a charge.

The order amount comes from the plan catalogue, never from the request — a
browser-supplied amount is a browser-supplied price. Order creation is **never
retried**, because retrying a charge can take the money twice; idempotent reads
are.

An unrecognised gateway status maps to `created`, never to paid.

## A privilege escalation the tests caught

The `admins update organization` policy legitimately lets an admin rename their
workspace. But RLS is *row*-level, so the same policy also permitted:

```sql
update organizations set ai_credits_limit = 999999;
```

A free user could grant themselves an unlimited plan. Postgres has no
column-level RLS, but `GRANT` is column-aware, so the fix is to narrow the grant:

```sql
revoke update on organizations from authenticated;
grant update (name, slug) on organizations to authenticated;
```

`plan` and `ai_credits_limit` are now writable only through
`apply_subscription`, which is service-role-only. Three tests assert it:
an admin cannot raise their limit, cannot promote their plan, and can still
rename their workspace.

## Refunds remove entitlement — in full, not in part

A *full* refund drops the organization back to free. Otherwise a customer could
pay, refund, and keep the plan.

A partial refund does not. It records `partially_refunded` and leaves the
entitlement alone: a goodwill refund of a rupee is not a cancellation, and
treating it as one billed the customer nothing and took their plan away.

## Attribution comes from our records first

`notes.organization_id` and `notes.plan_key` are echoed back by the gateway and
covered by the signature, so they cannot be forged. They can, however, be *set*
on a payment created outside our checkout — a payment link, or the dashboard —
and `plan_key` is a grant of entitlement.

So the order row we wrote when the checkout began wins: the payment's
`order_id` is looked up in `payment_orders`, and the notes are the fallback for
a payment with no order of ours behind it.

## Deliveries are not ordered

A gateway retries aggressively and delivers out of order. The event ledger stops
a duplicate being *processed* twice, but it does not stop a late
`payment.authorized` being processed *after* the `payment.captured` it precedes
— which used to overwrite the captured row and null out `captured_at`, turning a
paid customer back into an unpaid one.

Payment states are ranked by how settled they are, and a delivery that would
move a payment backwards down that ranking is recorded as stale and ignored.

## What is not built

The checkout UI, subscription (recurring mandate) creation — only one-off orders
are implemented — proration on mid-cycle upgrades, invoice PDFs, and dunning for
`past_due`. A `past_due` subscription currently drops to free limits immediately
rather than after a grace period.

**Nothing was exercised against the live API.** `api.razorpay.com` is blocked
from this environment, and calling a live key from a sandbox would move real
money. `fetch` is injectable, so request shape, auth, error classification and
retry policy are covered by tests against a fake transport; the wire itself is
not.
