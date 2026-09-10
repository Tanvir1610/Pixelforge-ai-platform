"use server";

import { randomUUID } from "node:crypto";
import { toString as qrToString } from "qrcode";
import { createServiceClient } from "@/lib/supabase/server";
import { hasOrgRole, requireSession } from "@/lib/auth/session";
import { createRazorpayClient, RazorpayError, RAZORPAY_ERROR_COPY } from "@/lib/payments/razorpay";
import { formatAmount, isPaidPlan, PLANS, type PlanKey } from "@/lib/payments/plans";
import {
  buildUpiUri, getUpiPayee, isValidUpiReference, normaliseUpiReference, upiNoteFor,
} from "@/lib/payments/upi";
import { verifyCheckoutSignature } from "@/lib/payments/verify";

/**
 * Checkout.
 *
 * The webhook, the Razorpay client, the signature verification and the plan
 * catalogue all existed; nothing ever *started* a payment, so the Upgrade
 * buttons had nowhere to go. This is the missing half.
 *
 * The amount is read from the plan catalogue on the server and never accepted
 * from the caller — a browser-supplied amount is a browser-supplied price. The
 * order is recorded before the user is sent to the gateway, so the webhook can
 * attribute the payment from our own records rather than from the payload.
 */
export type CheckoutStart =
  | {
      ok: true;
      orderId: string;
      amountMinor: number;
      currency: string;
      keyId: string;
      planKey: PlanKey;
      organizationName: string;
      prefillEmail: string;
      prefillName: string;
    }
  | { ok: false; error: string };

export async function startCheckoutAction(planKey: string): Promise<CheckoutStart> {
  if (!isPaidPlan(planKey)) {
    return { ok: false, error: "Choose a paid plan to continue." };
  }

  const session = await requireSession();

  if (session.demo) {
    return { ok: false, error: "Connect Supabase to take real payments." };
  }
  // Billing is an owner/admin action, not something any developer can trigger.
  if (!hasOrgRole(session, "admin")) {
    return { ok: false, error: "Only an owner or admin can change the workspace plan." };
  }
  if (session.organization.plan === planKey) {
    return { ok: false, error: `This workspace is already on ${PLANS[planKey].displayName}.` };
  }

  const keyId = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID ?? process.env.RAZORPAY_KEY_ID;
  if (!keyId || !process.env.RAZORPAY_KEY_SECRET) {
    return { ok: false, error: "Payments aren't configured on this deployment yet." };
  }

  const plan = PLANS[planKey];
  // Our own id travels with the order, so a payment can be traced back even if
  // the row below somehow failed to write.
  const receipt = `org_${session.organization.id.slice(0, 8)}_${Date.now().toString(36)}`;

  try {
    const order = await createRazorpayClient().createOrder({
      planKey,
      organizationId: session.organization.id,
      receipt,
    });

    // Service role: payment_orders has no client write policy, and the caller
    // has already been authorised above.
    const supabase = createServiceClient();
    const { error } = await supabase.from("payment_orders").insert({
      organization_id: session.organization.id,
      plan_key: planKey,
      provider: "razorpay",
      provider_order_id: order.id,
      amount_minor: plan.amountMinor,
      currency: plan.currency,
      status: "created",
      created_by: session.user.id,
    });

    if (error) {
      // Recorded and refused rather than sent to the gateway: an order the
      // webhook cannot attribute is a payment we cannot honour.
      console.error("[billing:order]", error.message);
      return { ok: false, error: "We couldn't start the checkout. Try again in a moment." };
    }

    return {
      ok: true,
      orderId: order.id,
      amountMinor: plan.amountMinor,
      currency: plan.currency,
      keyId,
      planKey,
      organizationName: session.organization.name,
      prefillEmail: session.user.email,
      prefillName: session.user.full_name ?? "",
    };
  } catch (error) {
    if (error instanceof RazorpayError) {
      console.error("[billing:razorpay]", error.code, error.providerCode);
      return { ok: false, error: RAZORPAY_ERROR_COPY[error.code] };
    }
    console.error("[billing:order]", error);
    return { ok: false, error: "We couldn't reach the payment provider. No charge was made." };
  }
}

/**
 * Confirms what Checkout handed back to the browser.
 *
 * This is for the success screen only. It deliberately does NOT grant the plan:
 * a determined user controls their own browser, and the webhook is the evidence
 * that money actually moved. Entitlement is applied there, once, idempotently.
 */
export async function confirmCheckoutAction(input: {
  orderId: string;
  paymentId: string;
  signature: string;
}): Promise<{ ok: boolean; message: string }> {
  const session = await requireSession();
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keySecret) return { ok: false, message: "Payments aren't configured on this deployment." };

  const valid = verifyCheckoutSignature({
    orderId: input.orderId,
    paymentId: input.paymentId,
    signature: input.signature,
    keySecret,
  });

  if (!valid) {
    console.error("[billing:confirm] signature mismatch", input.orderId);
    return { ok: false, message: "We couldn't verify that payment. If you were charged, contact support." };
  }

  // Scoped to the caller's own organization, so one workspace cannot read
  // another's order by guessing an id.
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("payment_orders")
    .select("organization_id")
    .eq("provider_order_id", input.orderId)
    .maybeSingle<{ organization_id: string }>();

  if (!data || data.organization_id !== session.organization.id) {
    return { ok: false, message: "That payment doesn't belong to this workspace." };
  }

  return {
    ok: true,
    message: "Payment received. Your plan updates within a few seconds, once the provider confirms it.",
  };
}

/* ---------------------------------------------------------------------------
 * UPI, verified by hand
 *
 * UPI collection through a plain VPA has no callback, so none of this grants
 * anything. It produces an intent the payer can open, records what they say
 * they sent, and leaves the decision to `verifyUpiClaimAction` below.
 * ------------------------------------------------------------------------- */

export type UpiStart =
  | {
      ok: true;
      orderId: string;
      amountMinor: number;
      amountLabel: string;
      planLabel: string;
      payeeVpa: string;
      payeeName: string;
      upiUri: string;
      qrSvg: string;
    }
  | { ok: false; error: string };

export async function startUpiPaymentAction(planKey: string): Promise<UpiStart> {
  if (!isPaidPlan(planKey)) return { ok: false, error: "Choose a paid plan to continue." };

  const session = await requireSession();
  if (session.demo) return { ok: false, error: "Connect Supabase to take real payments." };
  if (!hasOrgRole(session, "admin")) {
    return { ok: false, error: "Only an owner or admin can change the workspace plan." };
  }
  if (session.organization.plan === planKey) {
    return { ok: false, error: `This workspace is already on ${PLANS[planKey].displayName}.` };
  }

  let payee;
  try {
    payee = getUpiPayee();
  } catch (error) {
    console.error("[billing:upi]", error);
    return { ok: false, error: "UPI payment is misconfigured on this deployment." };
  }
  if (!payee) return { ok: false, error: "UPI payment isn't set up on this deployment yet." };

  const plan = PLANS[planKey];
  const supabase = createServiceClient();

  // The order exists before the QR is shown, so a payment always has one of our
  // own records behind it — the same rule the gateway flow follows.
  const providerOrderId = `upi_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  const { data: order, error } = await supabase
    .from("payment_orders")
    .insert({
      organization_id: session.organization.id,
      plan_key: planKey,
      provider: "upi_manual",
      provider_order_id: providerOrderId,
      amount_minor: plan.amountMinor,
      currency: plan.currency,
      status: "created",
      created_by: session.user.id,
    })
    .select("id")
    .single();

  if (error || !order) {
    console.error("[billing:upi:order]", error?.message);
    return { ok: false, error: "We couldn't start the payment. Try again in a moment." };
  }

  const upiUri = buildUpiUri({
    payee,
    amountMinor: plan.amountMinor,
    note: upiNoteFor(plan.displayName, order.id),
  });

  // Generated, not a stored image: a static QR carries no amount, so the payer
  // would have to type it and could type it wrong.
  const qrSvg = await qrToString(upiUri, { type: "svg", margin: 1, errorCorrectionLevel: "M" });

  return {
    ok: true,
    orderId: order.id,
    amountMinor: plan.amountMinor,
    amountLabel: formatAmount(plan.amountMinor, plan.currency),
    planLabel: plan.displayName,
    payeeVpa: payee.vpa,
    payeeName: payee.name,
    upiUri,
    qrSvg,
  };
}

/**
 * Records what the payer says they sent.
 *
 * Explicitly does not grant the plan. The row is a claim, and the only path
 * from a claim to an entitlement is `verify_upi_payment`, which the service
 * role holds and a signed-in user does not.
 */
export async function submitUpiReferenceAction(input: {
  orderId: string;
  reference: string;
}): Promise<{ ok: boolean; message: string }> {
  const session = await requireSession();
  if (!hasOrgRole(session, "admin")) {
    return { ok: false, message: "Only an owner or admin can submit a payment reference." };
  }

  if (!isValidUpiReference(input.reference)) {
    return { ok: false, message: "A UPI reference is the 12-digit UTR shown in your payment app." };
  }
  const reference = normaliseUpiReference(input.reference);

  const supabase = createServiceClient();

  // Scoped to the caller's own organization, so an order id from elsewhere
  // cannot be claimed against this workspace.
  const { data: order } = await supabase
    .from("payment_orders")
    .select("id, organization_id, plan_key, amount_minor, status")
    .eq("id", input.orderId)
    .maybeSingle<{
      id: string; organization_id: string; plan_key: string; amount_minor: number; status: string;
    }>();

  if (!order || order.organization_id !== session.organization.id) {
    return { ok: false, message: "That payment doesn't belong to this workspace." };
  }
  if (order.status === "captured") {
    return { ok: true, message: "This payment is already confirmed." };
  }

  const { error } = await supabase.from("upi_payment_claims").insert({
    organization_id: order.organization_id,
    payment_order_id: order.id,
    plan_key: order.plan_key,
    amount_minor: order.amount_minor,
    reference,
    claimed_by: session.user.id,
  });

  if (error) {
    // The reference is unique: the same transaction cannot be claimed twice,
    // here or by another workspace.
    if (error.code === "23505") {
      return { ok: false, message: "That reference has already been submitted." };
    }
    console.error("[billing:upi:claim]", error.message);
    return { ok: false, message: "We couldn't record that reference. Try again in a moment." };
  }

  return {
    ok: true,
    message:
      "Reference received. Your plan activates once the payment is confirmed against the account — " +
      "usually within a few hours.",
  };
}

/**
 * Approves or rejects a claim.
 *
 * Restricted to the platform operators named in PLATFORM_ADMIN_EMAILS, not to
 * workspace admins: the person who paid must never be the person who confirms
 * the payment arrived.
 */
export async function verifyUpiClaimAction(input: {
  claimId: string;
  approve: boolean;
  note?: string;
}): Promise<{ ok: boolean; message: string }> {
  const session = await requireSession();

  const operators = (process.env.PLATFORM_ADMIN_EMAILS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

  if (operators.length === 0) {
    return { ok: false, message: "No platform operators are configured, so claims cannot be reviewed." };
  }
  if (!operators.includes(session.user.email.toLowerCase())) {
    return { ok: false, message: "Only a platform operator can confirm a payment." };
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("verify_upi_payment", {
    p_claim_id: input.claimId,
    p_approve: input.approve,
    p_reviewer: session.user.id,
    p_note: input.note ?? null,
  });

  if (error) {
    console.error("[billing:upi:verify]", error.message);
    return { ok: false, message: `Could not review that claim: ${error.message}` };
  }

  return { ok: true, message: `Claim ${data as string}.` };
}
