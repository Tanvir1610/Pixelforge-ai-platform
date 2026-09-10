"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Banner } from "@/components/ui/banner";
import { confirmCheckoutAction, startCheckoutAction } from "@/lib/actions/billing";

/**
 * Opens Razorpay Checkout for a plan.
 *
 * The order is created by a server action first, so the amount comes from the
 * plan catalogue rather than from here. This component only opens the gateway's
 * own modal with the order id it is handed.
 *
 * The `handler` result is used for the success screen and nothing else. What a
 * browser reports about a payment is not evidence that money moved — the
 * webhook is, and that is where the plan is actually granted.
 */
const CHECKOUT_SCRIPT = "https://checkout.razorpay.com/v1/checkout.js";

interface RazorpayResponse {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

interface RazorpayOptions {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  order_id: string;
  prefill: { name?: string; email?: string };
  theme: { color: string };
  handler: (response: RazorpayResponse) => void;
  modal: { ondismiss: () => void };
}

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => { open: () => void };
  }
}

/** Loaded on demand, so the gateway's script is not on every page. */
function loadCheckout(): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  if (window.Razorpay) return Promise.resolve(true);

  return new Promise((resolve) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${CHECKOUT_SCRIPT}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(Boolean(window.Razorpay)), { once: true });
      existing.addEventListener("error", () => resolve(false), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = CHECKOUT_SCRIPT;
    script.async = true;
    script.onload = () => resolve(Boolean(window.Razorpay));
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

export function CheckoutButton({
  planKey,
  label,
  variant = "primary",
  size = "md",
  className,
}: {
  planKey: "pro" | "team";
  label: string;
  variant?: "primary" | "dark" | "secondary";
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [notice, setNotice] = React.useState<{ tone: "error" | "success"; text: string } | null>(null);

  async function begin() {
    setPending(true);
    setNotice(null);

    const start = await startCheckoutAction(planKey);
    if (!start.ok) {
      setNotice({ tone: "error", text: start.error });
      setPending(false);
      return;
    }

    const ready = await loadCheckout();
    if (!ready || !window.Razorpay) {
      setNotice({
        tone: "error",
        text: "The payment window couldn't load. Check your connection or any script blocker, then try again.",
      });
      setPending(false);
      return;
    }

    const checkout = new window.Razorpay({
      key: start.keyId,
      amount: start.amountMinor,
      currency: start.currency,
      name: "PixelForge AI",
      description: `${start.planKey === "pro" ? "Pro" : "Team"} plan · ${start.organizationName}`,
      order_id: start.orderId,
      prefill: { name: start.prefillName, email: start.prefillEmail },
      theme: { color: "#6366F1" },
      handler: (response) => {
        void confirmCheckoutAction({
          orderId: response.razorpay_order_id,
          paymentId: response.razorpay_payment_id,
          signature: response.razorpay_signature,
        }).then((result) => {
          setNotice({ tone: result.ok ? "success" : "error", text: result.message });
          setPending(false);
          // The webhook applies the plan; refreshing picks it up once it lands.
          if (result.ok) router.refresh();
        });
      },
      // Closing the modal is a normal thing to do, not a failure.
      modal: { ondismiss: () => setPending(false) },
    });

    checkout.open();
  }

  return (
    <div className={className}>
      <Button variant={variant} size={size} loading={pending} onClick={begin} className="w-full">
        {label}
      </Button>
      {notice && (
        <Banner tone={notice.tone} className="mt-3">
          {notice.text}
        </Banner>
      )}
    </div>
  );
}
