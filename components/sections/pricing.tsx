import Link from "next/link";
import { Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { CheckoutButton } from "@/components/billing/checkout-button";
import { UpiCheckout } from "@/components/billing/upi-checkout";
import { formatAmount, PLANS as CATALOGUE } from "@/lib/payments/plans";
import { cn } from "@/lib/utils";

/**
 * Prices come from the plan catalogue, which is what checkout actually charges.
 *
 * They were hardcoded as "$29" and "$99" while `lib/payments/plans.ts` charges
 * INR 2,499 and 8,299 — so the page advertised a price no order would ever be
 * created for. A pricing page that disagrees with the till is worse than one
 * that is merely out of date.
 */
export const PLANS = [
  {
    key: "free" as const,
    name: CATALOGUE.free.displayName, description: "For experimenting.",
    price: formatAmount(CATALOGUE.free.amountMinor), cta: "Start for free", href: "/signup",
    features: ["3 projects", "50 AI credits monthly", "React and HTML export", "Live preview and comparison", "Community support"],
  },
  {
    key: "pro" as const,
    name: CATALOGUE.pro.displayName, description: "For serious creators.",
    price: formatAmount(CATALOGUE.pro.amountMinor), cta: "Upgrade to Pro", href: "/signup", highlight: true,
    features: ["Unlimited projects", "2,000 AI credits monthly", "Every framework and styling option", "Fix differences in one action", "One-click deployment", "GitHub sync and custom domains"],
  },
  {
    key: "team" as const,
    name: CATALOGUE.team.displayName, description: "For agencies and teams.",
    price: formatAmount(CATALOGUE.team.amountMinor), cta: "Upgrade to Team", href: "/signup",
    features: ["Everything in Pro", "10,000 shared AI credits", "Shared component library", "Roles and permissions", "SSO and audit log", "Priority support"],
  },
];

/**
 * `signedIn` decides what the call to action does: a visitor is sent to sign up,
 * someone already in a workspace goes straight to checkout. The buttons used to
 * link to /signup either way, which sent a paying customer back to a form for an
 * account they already had.
 */
export function PricingPlans({
  className,
  signedIn = false,
  upiEnabled = false,
  gatewayEnabled = false,
}: {
  className?: string;
  signedIn?: boolean;
  /** Which payment methods this deployment can actually take. */
  upiEnabled?: boolean;
  gatewayEnabled?: boolean;
}) {
  return (
    <ul className={cn("grid gap-5 lg:grid-cols-3", className)}>
      {PLANS.map((plan) => (
        <li
          key={plan.name}
          className={cn(
            "flex flex-col rounded-xl border bg-bg-surface p-7",
            plan.highlight ? "border-bg-dark shadow-lg" : "border-border",
          )}
        >
          <div className="flex items-center justify-between">
            <h3 className="text-[16px] font-semibold">{plan.name}</h3>
            {plan.highlight && <Badge tone="dark">Most popular</Badge>}
          </div>
          <p className="mb-5 mt-1 text-body-sm text-content-muted">{plan.description}</p>
          <p className="font-display text-[40px] font-bold leading-none tracking-[-0.03em]">
            {plan.price}
            <span className="font-sans text-body font-normal tracking-normal text-content-muted"> / month</span>
          </p>
          <ul className="mt-6 flex flex-1 flex-col gap-2.5 text-body-sm text-content-secondary">
            {plan.features.map((feature) => (
              <li key={feature} className="flex items-center gap-2.5">
                <Check aria-hidden className="h-3.5 w-3.5 shrink-0 text-content" />
                {feature}
              </li>
            ))}
          </ul>
          {signedIn && plan.key !== "free" ? (
            <>
              {/* Only methods this deployment is actually set up for. Showing a
                  button that can only report "not configured" wastes a click and
                  reads as a broken product. */}
              {upiEnabled && (
                <UpiCheckout
                  planKey={plan.key}
                  label={`Pay by UPI · ${plan.price}`}
                  variant={plan.highlight ? "primary" : "secondary"}
                />
              )}
              {gatewayEnabled && (
                <CheckoutButton
                  planKey={plan.key}
                  label={upiEnabled ? "Pay by card or netbanking" : plan.cta}
                  variant={upiEnabled ? "secondary" : plan.highlight ? "primary" : "secondary"}
                  className="mt-3"
                />
              )}
              {!upiEnabled && !gatewayEnabled && (
                <p className="mt-6 rounded-md border border-border bg-bg p-3 text-body-sm text-content-muted">
                  Payments aren&apos;t set up on this deployment yet.
                </p>
              )}
            </>
          ) : (
            <Link
              href={signedIn ? "/dashboard" : plan.href}
              className={buttonClasses(plan.highlight ? "primary" : "secondary", "md", "mt-6 w-full")}
            >
              {signedIn ? "Go to dashboard" : plan.cta}
            </Link>
          )}
        </li>
      ))}
    </ul>
  );
}

export function PricingSection() {
  return (
    <section id="pricing" className="mx-auto max-w-container px-5 py-16 md:px-10 md:py-20 lg:px-20">
      <h2 className="font-display text-[28px] font-bold tracking-[-0.025em] md:text-h1">Pricing</h2>
      <p className="mt-3 text-body md:text-body-lg text-content-secondary">
        Start free. Upgrade when a project ships.
      </p>
      <PricingPlans className="mt-12" />
    </section>
  );
}
