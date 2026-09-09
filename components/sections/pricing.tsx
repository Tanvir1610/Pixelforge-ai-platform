import Link from "next/link";
import { Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const PLANS = [
  {
    name: "Free", description: "For experimenting.", price: "$0", cta: "Start for free", href: "/signup",
    features: ["3 projects", "50 AI credits monthly", "React and HTML export", "Live preview and comparison", "Community support"],
  },
  {
    name: "Pro", description: "For serious creators.", price: "$29", cta: "Start 14-day trial", href: "/signup", highlight: true,
    features: ["Unlimited projects", "2,000 AI credits monthly", "Every framework and styling option", "Fix differences in one action", "One-click deployment", "GitHub sync and custom domains"],
  },
  {
    name: "Team", description: "For agencies and teams.", price: "$99", cta: "Talk to us", href: "/signup",
    features: ["Everything in Pro", "10,000 shared AI credits", "Shared component library", "Roles and permissions", "SSO and audit log", "Priority support"],
  },
];

export function PricingPlans({ className }: { className?: string }) {
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
          <Link
            href={plan.href}
            className={buttonClasses(plan.highlight ? "primary" : "secondary", "md", "mt-6 w-full")}
          >
            {plan.cta}
          </Link>
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
