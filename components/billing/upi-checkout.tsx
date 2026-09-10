"use client";

import * as React from "react";
import { Check, Copy, QrCode, Smartphone } from "lucide-react";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { startUpiPaymentAction, submitUpiReferenceAction, type UpiStart } from "@/lib/actions/billing";

/**
 * Pay by UPI.
 *
 * UPI through a plain VPA has no callback, so this deliberately stops short of
 * confirming anything. It opens an intent with the amount already filled in,
 * then collects the reference the payer reads back off their app. The plan is
 * granted later, by a person checking the account — see migration 0017.
 *
 * Saying "paid!" here and unlocking the plan would mean anyone could upgrade by
 * typing twelve digits, so the copy is careful never to imply that.
 */
type Stage =
  | { name: "idle" }
  | { name: "starting" }
  | { name: "paying"; payment: Extract<UpiStart, { ok: true }> }
  | { name: "submitted"; message: string };

export function UpiCheckout({
  planKey,
  label,
  variant = "primary",
}: {
  planKey: "pro" | "team";
  label: string;
  variant?: "primary" | "secondary" | "dark";
}) {
  const [stage, setStage] = React.useState<Stage>({ name: "idle" });
  const [error, setError] = React.useState<string | null>(null);
  const [reference, setReference] = React.useState("");
  const [copied, setCopied] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);

  async function begin() {
    setStage({ name: "starting" });
    setError(null);

    const result = await startUpiPaymentAction(planKey);
    if (!result.ok) {
      setError(result.error);
      setStage({ name: "idle" });
      return;
    }
    setStage({ name: "paying", payment: result });
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (stage.name !== "paying") return;

    setSubmitting(true);
    setError(null);

    const result = await submitUpiReferenceAction({
      orderId: stage.payment.orderId,
      reference,
    });

    setSubmitting(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setStage({ name: "submitted", message: result.message });
  }

  async function copyVpa(vpa: string) {
    try {
      await navigator.clipboard.writeText(vpa);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused; the id is on screen to be typed.
    }
  }

  if (stage.name === "submitted") {
    return (
      <Banner tone="success" className="mt-6">
        {stage.message}
      </Banner>
    );
  }

  if (stage.name === "paying") {
    const { payment } = stage;
    return (
      <div className="mt-6 flex flex-col gap-4 rounded-lg border border-border bg-bg p-4">
        <div>
          <p className="text-body font-semibold">
            Pay {payment.amountLabel} for {payment.planLabel}
          </p>
          <p className="mt-0.5 text-body-sm text-content-muted">
            Scan with any UPI app. The amount is already filled in — please don&apos;t change it, or the
            payment can&apos;t be matched to your workspace.
          </p>
        </div>

        {/* Generated for this order, so it carries the exact amount. */}
        <div
          className="mx-auto w-[200px] rounded-md bg-white p-2 [&>svg]:h-full [&>svg]:w-full"
          // The SVG is produced server-side by the qrcode encoder from our own
          // URI; no part of it comes from user input.
          dangerouslySetInnerHTML={{ __html: payment.qrSvg }}
        />

        <div className="flex flex-col gap-1.5 rounded-md border border-border bg-bg-surface p-3">
          <span className="text-caption text-content-muted">Paying to</span>
          <span className="text-body-sm font-medium">{payment.payeeName}</span>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate font-mono text-body-sm">{payment.payeeVpa}</code>
            <Button
              type="button"
              variant="secondary"
              size="xs"
              onClick={() => copyVpa(payment.payeeVpa)}
              aria-label="Copy UPI ID"
            >
              {copied ? <Check /> : <Copy />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </div>

        {/* On a phone this opens the UPI app directly; on a desktop it does
            nothing useful, which is what the QR above is for. */}
        <a href={payment.upiUri} className="sm:hidden">
          <Button type="button" variant="dark" className="w-full">
            <Smartphone />
            Open in a UPI app
          </Button>
        </a>

        <form onSubmit={submit} className="flex flex-col gap-2.5 border-t border-border pt-4">
          <Field
            label="UPI reference number"
            htmlFor="upi-reference"
            help="The 12-digit UTR your payment app shows after a successful transfer."
          >
            <Input
              id="upi-reference"
              inputMode="numeric"
              autoComplete="off"
              placeholder="123456789012"
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              required
            />
          </Field>
          {error && <Banner tone="error">{error}</Banner>}
          <Button type="submit" variant="primary" loading={submitting} className="w-full">
            I&apos;ve paid — submit reference
          </Button>
          <p className="text-caption text-content-muted">
            Your plan activates once the payment is confirmed against the account. Submitting a reference
            does not upgrade the workspace on its own.
          </p>
        </form>
      </div>
    );
  }

  return (
    <div className="mt-6">
      <Button
        type="button"
        variant={variant}
        loading={stage.name === "starting"}
        onClick={begin}
        className="w-full"
      >
        <QrCode />
        {label}
      </Button>
      {error && (
        <Banner tone="error" className="mt-3">
          {error}
        </Banner>
      )}
    </div>
  );
}
