/**
 * Plan catalogue mirror.
 *
 * The database is the source of truth (`billing_plans`); this exists so the
 * marketing page and checkout can render without a query, and so amounts are
 * typed. Both must agree — the test suite asserts the shape, and the migration
 * asserts the values.
 */
export type PlanKey = "free" | "pro" | "team";

export interface Plan {
  key: PlanKey;
  displayName: string;
  /** Minor units. Never a float: 0.1 + 0.2 must not decide a charge. */
  amountMinor: number;
  currency: "INR";
  aiCredits: number;
  maxProjects: number | null;
}

export const PLANS: Record<PlanKey, Plan> = {
  free: { key: "free", displayName: "Free", amountMinor: 0, currency: "INR", aiCredits: 50, maxProjects: 3 },
  pro: { key: "pro", displayName: "Pro", amountMinor: 249_900, currency: "INR", aiCredits: 2_000, maxProjects: null },
  team: { key: "team", displayName: "Team", amountMinor: 829_900, currency: "INR", aiCredits: 10_000, maxProjects: null },
};

export function isPaidPlan(key: string): key is Exclude<PlanKey, "free"> {
  return key === "pro" || key === "team";
}

/** Formats minor units for display. Rounding here would misstate a price. */
export function formatAmount(amountMinor: number, currency = "INR"): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    minimumFractionDigits: amountMinor % 100 === 0 ? 0 : 2,
  }).format(amountMinor / 100);
}

/**
 * Whether a plan change takes effect immediately.
 *
 * Upgrades apply at once — the user paid for more and should get it now.
 * Downgrades wait for the period end, because cutting entitlements someone has
 * already paid for is theft, even if it is only a few days of it.
 */
export function isUpgrade(from: PlanKey, to: PlanKey): boolean {
  const rank: Record<PlanKey, number> = { free: 0, pro: 1, team: 2 };
  return rank[to] > rank[from];
}
