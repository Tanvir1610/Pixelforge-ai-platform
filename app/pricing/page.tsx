import type { Metadata } from "next";
import { Check } from "lucide-react";
import { MarketingNav } from "@/components/layout/marketing-nav";
import { SiteFooter } from "@/components/layout/site-footer";
import { PricingPlans } from "@/components/sections/pricing";
import { BillingToggle } from "./billing-toggle";
import { getSession } from "@/lib/auth/session";
import { isUpiConfigured } from "@/lib/payments/upi";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Free, Pro and Team plans. Every plan includes full code export.",
};

const ROWS = [
  { label: "Projects", free: "3", pro: "Unlimited", team: "Unlimited" },
  { label: "AI credits per month", free: "50", pro: "2,000", team: "10,000 shared" },
  { label: "Frameworks", free: "React, HTML", pro: "All four", team: "All four" },
  { label: "Styling options", free: "Tailwind", pro: "All three", team: "All three" },
  { label: "Visual comparison", free: true, pro: true, team: true },
  { label: "Fix differences automatically", free: false, pro: true, team: true },
  { label: "Custom domains", free: false, pro: true, team: true },
  { label: "Shared component library", free: false, pro: false, team: true },
  { label: "SSO and audit log", free: false, pro: false, team: true },
  { label: "Support", free: "Community", pro: "Email · 1 business day", team: "Priority · shared channel" },
];

function Cell({ value }: { value: string | boolean }) {
  if (value === true) return <Check aria-label="Included" className="h-3.5 w-3.5" />;
  if (value === false) return <span className="text-content-muted" aria-label="Not included">—</span>;
  return <>{value}</>;
}

// Session-dependent now: a signed-in visitor gets checkout rather than a
// sign-up link, so this cannot be prerendered once for everyone.
export const dynamic = "force-dynamic";

export default async function PricingPage() {
  const session = await getSession();
  const signedIn = Boolean(session) && !session?.demo;
  // Read on the server: which methods exist is a deployment fact, not
  // something the browser should be told to guess at.
  const upiEnabled = isUpiConfigured();
  const gatewayEnabled = Boolean(process.env.RAZORPAY_KEY_SECRET && process.env.RAZORPAY_KEY_ID);

  return (
    <>
      <MarketingNav />
      <main id="main">
        <section className="mx-auto max-w-container px-5 pt-16 text-center md:px-10 lg:px-20">
          <h1 className="font-display text-[32px] font-bold tracking-[-0.025em] md:text-h1">Pay for what you ship</h1>
          <p className="mx-auto mb-6 mt-3 max-w-prose text-body md:text-body-lg text-content-secondary">
            Every plan includes full code export. Credits cover generation and refinement; analysis and preview are
            free.
          </p>
          <BillingToggle />
        </section>

        <section className="mx-auto max-w-container px-5 py-10 md:px-10 lg:px-20">
          <PricingPlans signedIn={signedIn} upiEnabled={upiEnabled} gatewayEnabled={gatewayEnabled} />
        </section>

        <section className="mx-auto max-w-container px-5 pb-20 md:px-10 lg:px-20">
          <div className="overflow-x-auto rounded-lg border border-border bg-bg-surface scrollbar-thin">
            <table className="w-full min-w-[640px] text-body-sm">
              <caption className="sr-only">Feature comparison across Free, Pro and Team plans</caption>
              <thead>
                <tr className="text-left text-caption text-content-muted">
                  <th scope="col" className="w-2/5 border-b border-border px-4 py-2.5 font-medium">Compare plans</th>
                  <th scope="col" className="border-b border-border px-4 py-2.5 font-medium">Free</th>
                  <th scope="col" className="border-b border-border px-4 py-2.5 font-medium">Pro</th>
                  <th scope="col" className="border-b border-border px-4 py-2.5 font-medium">Team</th>
                </tr>
              </thead>
              <tbody>
                {ROWS.map((row) => (
                  <tr key={row.label}>
                    <th scope="row" className="border-b border-border px-4 py-3 text-left font-normal">{row.label}</th>
                    <td className="border-b border-border px-4 py-3"><Cell value={row.free} /></td>
                    <td className="border-b border-border px-4 py-3"><Cell value={row.pro} /></td>
                    <td className="border-b border-border px-4 py-3"><Cell value={row.team} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3.5 text-caption text-content-muted">
            Need more than 10,000 credits or on-premise processing? We&apos;ll put together an enterprise plan.
          </p>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
