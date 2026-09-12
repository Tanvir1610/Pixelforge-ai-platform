import type { Metadata } from "next";
import Link from "next/link";
import { Clock, Coins, Sparkles, TrendingUp } from "lucide-react";
import { AppShell, PageHeading } from "@/components/layout/app-shell";
import { DemoBanner } from "@/components/layout/demo-banner";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { buttonClasses } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Progress } from "@/components/ui/progress";
import { requireSession } from "@/lib/auth/session";
import {
  agentLabel, creditsByDay, getCreditBalance, listCreditActivity, listCreditHolds,
} from "@/lib/repositories/credits";

/**
 * Where the credits went.
 *
 * The only thing the product said about credits was a bar in the sidebar, and
 * that bar summed `usage_records` directly — so it counted what had been
 * charged and knew nothing about what was currently held. A user mid-generation
 * saw the balance from before it started.
 *
 * Worse, there was nowhere at all to see *what* had been spent. Every model
 * call has been recorded in `model_runs` since Phase 3 — agent, model, tokens,
 * cost, latency, and whether it failed — and none of it was ever shown.
 */
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Usage and credits" };

/** Whole credits read better than three decimal places of one. */
function credits(value: number): string {
  return value >= 10 || Number.isInteger(value) ? String(Math.round(value)) : value.toFixed(1);
}

function relative(iso: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

export default async function UsagePage() {
  const session = await requireSession();

  const [balance, activity, holds, daily] = await Promise.all([
    getCreditBalance(session),
    listCreditActivity(session, 50),
    listCreditHolds(session),
    creditsByDay(session),
  ]);

  const peak = Math.max(1, ...daily.map((entry) => entry.credits));
  const resetLabel = new Date(balance.resetsAt).toLocaleDateString(undefined, {
    day: "numeric", month: "long",
  });

  // Only ever counts calls that actually succeeded; a failed one costs tokens
  // at the provider but is released rather than charged.
  const spendUsd = activity.reduce((total, entry) => total + entry.costUsd, 0);

  return (
    <AppShell crumbs={["Usage"]}>
      {session.demo && <DemoBanner />}
      <PageHeading
        title="Usage and credits"
        description={`Charged from the 1st. This window resets on ${resetLabel}.`}
        actions={
          <Link href="/pricing" className={buttonClasses("secondary", "sm")}>
            <TrendingUp />
            Plans
          </Link>
        }
      />

      {balance.remaining <= 0 && balance.limit > 0 && (
        <Banner tone="error" className="mb-5">
          <b className="font-semibold">No credits left this month.</b> Analysis and preview still work.
          Generation and the assistant resume on {resetLabel}, or immediately on a larger plan.
        </Banner>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Remaining" value={credits(balance.remaining)} icon={Coins} accent />
        <Stat label="Charged this month" value={credits(balance.used)} icon={Sparkles} />
        <Stat
          label="Held right now"
          value={credits(balance.held)}
          icon={Clock}
          note={holds.length > 0 ? `${holds.length} in flight` : undefined}
        />
        <Stat label="Monthly limit" value={credits(balance.limit)} icon={TrendingUp} />
      </div>

      <Card className="mb-5">
        <CardHeader
          title="This month"
          description="Held credits count against the balance until the work they belong to finishes."
        />
        <CardBody>
          <Progress value={balance.percentUsed} label="Credits used" />
          <p className="text-body-sm text-content-muted">
            {credits(balance.used)} charged
            {balance.held > 0 ? `, ${credits(balance.held)} held` : ""} of {credits(balance.limit)}.
          </p>

          {/* The gap between "used" and "remaining" reads as a bug unless the
              holds behind it are named. */}
          {holds.length > 0 && (
            <ul className="flex flex-col gap-1.5 rounded-[10px] border border-border p-3">
              {holds.map((hold) => (
                <li key={hold.id} className="flex items-center justify-between gap-3 text-body-sm">
                  <span className="min-w-0 truncate">{hold.purpose}</span>
                  <span className="shrink-0 font-mono text-caption text-content-muted">
                    {credits(hold.reserved)} · started {relative(hold.createdAt)}
                  </span>
                </li>
              ))}
              <li className="text-caption text-content-muted">
                A hold left by a run that stopped is released automatically after 30 minutes.
              </li>
            </ul>
          )}

          {daily.length > 0 && (
            <div>
              <h3 className="mb-2 text-caption font-semibold text-content-muted">Charged per day</h3>
              <ul className="flex h-20 items-end gap-1">
                {daily.map((entry) => (
                  <li
                    key={entry.day}
                    className="min-w-[6px] flex-1 rounded-t-[2px] bg-accent-soft"
                    style={{ height: `${Math.max(4, (entry.credits / peak) * 100)}%` }}
                    title={`${entry.day}: ${credits(entry.credits)} credits`}
                  />
                ))}
              </ul>
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Every call"
          description="What the platform asked a model to do on your behalf, and what it cost."
        />
        {activity.length === 0 ? (
          <EmptyState
            icon={<Sparkles />}
            title="Nothing spent yet"
            body="Analysis, planning, code generation and the assistant each make model calls. They appear here the moment one runs."
            action={
              <Link href="/dashboard/understanding" className={buttonClasses("primary", "sm")}>
                Analyse a design
              </Link>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-body-sm">
              <caption className="sr-only">Model calls this workspace has made</caption>
              <thead>
                <tr className="bg-bg text-left text-caption text-content-muted">
                  <th scope="col" className="border-b border-border px-4 py-2.5 font-medium">What</th>
                  <th scope="col" className="border-b border-border px-4 py-2.5 font-medium">Project</th>
                  <th scope="col" className="border-b border-border px-4 py-2.5 font-medium">Model</th>
                  <th scope="col" className="border-b border-border px-4 py-2.5 text-right font-medium">Tokens</th>
                  <th scope="col" className="border-b border-border px-4 py-2.5 text-right font-medium">When</th>
                </tr>
              </thead>
              <tbody>
                {activity.map((entry) => (
                  <tr key={entry.id}>
                    <td className="border-b border-border px-4 py-2.5">
                      <span className="flex items-center gap-2">
                        {agentLabel(entry.agent)}
                        {entry.status === "failed" && <Badge tone="error">Failed</Badge>}
                      </span>
                    </td>
                    <td className="border-b border-border px-4 py-2.5 text-content-muted">
                      {entry.projectName ?? "—"}
                    </td>
                    <td className="border-b border-border px-4 py-2.5 font-mono text-caption text-content-muted">
                      {entry.modelKey}
                    </td>
                    <td className="border-b border-border px-4 py-2.5 text-right font-mono text-caption text-content-muted">
                      {(entry.inputTokens + entry.outputTokens).toLocaleString()}
                    </td>
                    <td className="border-b border-border px-4 py-2.5 text-right text-content-muted">
                      {relative(entry.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Provider cost, not a price. Shown because it is the honest answer to
          "what is a credit", and hiding it would make the number arbitrary. */}
      {spendUsd > 0 && (
        <p className="mt-3 text-caption text-content-muted">
          Provider cost of the {activity.length} calls listed: ${spendUsd.toFixed(4)}. A credit is
          roughly a thousand output tokens, rounded up, so short calls still cost one.
        </p>
      )}
    </AppShell>
  );
}

function Stat({ label, value, icon: Icon, note, accent = false }: {
  label: string; value: string; icon: React.ElementType; note?: string; accent?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-bg-surface px-5 py-[18px]">
      <div className="flex items-center justify-between text-body-sm text-content-muted">
        {label}
        <Icon aria-hidden className="h-4 w-4" />
      </div>
      <b className={`mt-1.5 block font-display text-[28px] font-bold tracking-[-0.02em] ${accent ? "text-accent" : ""}`}>
        {value}
      </b>
      {note && <span className="text-caption text-content-muted">{note}</span>}
    </div>
  );
}
