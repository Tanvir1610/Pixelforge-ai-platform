import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppShell, PageHeading } from "@/components/layout/app-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { Banner } from "@/components/ui/banner";
import { IndianRupee } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/server";
import { formatAmount } from "@/lib/payments/plans";
import { relativeTime } from "@/lib/repositories/library";
import { ClaimReview } from "./claim-review";

/**
 * UPI claim review.
 *
 * UPI has no callback, so a person has to check the account and say whether the
 * money arrived. That person is a platform operator, never the workspace admin
 * who submitted the claim — the payer confirming their own payment is the whole
 * attack this flow has to survive.
 *
 * Deliberately not linked from the workspace navigation: it is not a customer
 * screen, and everyone who needs it can type the path.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "UPI payments", robots: { index: false, follow: false } };

interface ClaimRow {
  id: string;
  organization_id: string;
  plan_key: string;
  amount_minor: number;
  reference: string;
  status: "pending" | "verified" | "rejected";
  note: string | null;
  claimed_at: string;
  reviewed_at: string | null;
}

function operators(): string[] {
  return (process.env.PLATFORM_ADMIN_EMAILS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

export default async function UpiPaymentsPage() {
  const session = await requireSession();
  const allowed = operators();

  // A 404 rather than a "forbidden" page: an operator console is not something
  // to confirm the existence of to whoever asks.
  if (allowed.length === 0 || !allowed.includes(session.user.email.toLowerCase())) {
    redirect("/dashboard");
  }

  // Service role: the claims table has no cross-organization read policy, and
  // an operator legitimately reviews claims from every workspace.
  const supabase = createServiceClient();
  const { data: claims } = await supabase
    .from("upi_payment_claims")
    .select("id, organization_id, plan_key, amount_minor, reference, status, note, claimed_at, reviewed_at")
    .order("claimed_at", { ascending: false })
    .limit(100)
    .overrideTypes<ClaimRow[]>();

  const rows = claims ?? [];
  const orgIds = [...new Set(rows.map((claim) => claim.organization_id))];

  const { data: orgs } = orgIds.length
    ? await supabase.from("organizations").select("id, name").in("id", orgIds)
    : { data: [] as { id: string; name: string }[] };

  const names = new Map((orgs ?? []).map((org) => [org.id, org.name]));
  const pending = rows.filter((claim) => claim.status === "pending");

  return (
    <AppShell crumbs={["Operations", "UPI payments"]}>
      <PageHeading
        title="UPI payments"
        description="Confirm a transfer against the receiving account before it grants a plan."
      />

      <Banner tone="warning" className="mb-6">
        <b className="font-semibold">Check the account first.</b> A reference here is only what the payer
        typed. Approving writes the payment and activates the plan immediately, and nothing downstream
        re-checks it.
      </Banner>

      {rows.length === 0 ? (
        <EmptyState
          icon={<IndianRupee />}
          title="No UPI claims yet"
          body="When someone pays by UPI and submits their reference, it appears here for review."
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((claim) => (
            <li
              key={claim.id}
              className="flex flex-col gap-3 rounded-lg border border-border bg-bg-surface p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="text-body font-semibold">
                  {names.get(claim.organization_id) ?? "Unknown workspace"} ·{" "}
                  {formatAmount(claim.amount_minor)} · {claim.plan_key}
                </p>
                <p className="mt-0.5 truncate font-mono text-body-sm text-content-secondary">
                  UTR {claim.reference}
                </p>
                <p className="mt-0.5 text-caption text-content-muted">
                  Claimed {relativeTime(claim.claimed_at)}
                  {claim.status !== "pending" && ` · ${claim.status}`}
                  {claim.note && ` · ${claim.note}`}
                </p>
              </div>
              {claim.status === "pending" ? (
                <ClaimReview claimId={claim.id} />
              ) : (
                <span className="shrink-0 text-body-sm text-content-muted">
                  Reviewed {claim.reviewed_at ? relativeTime(claim.reviewed_at) : ""}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {pending.length > 0 && (
        <p className="mt-6 text-body-sm text-content-muted">
          {pending.length} awaiting review.
        </p>
      )}
    </AppShell>
  );
}
