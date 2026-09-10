import "server-only";

import { cache } from "react";
import { getSession } from "@/lib/auth/session";
import { getProjectStats } from "@/lib/repositories/projects";

/**
 * Everything the dashboard chrome renders.
 *
 * The sidebar and topbar were hardcoded — "Basalt Studio", "Pro workspace",
 * "Tanvir Ahmad", a 12-project badge and a 1,240/2,000 credit bar — while the
 * page beside them showed the signed-in user's real figures. So the same screen
 * disagreed with itself, and a new account was greeted by name and then told it
 * belonged to somebody else's workspace.
 *
 * Assembled in one cached call because the chrome renders on every dashboard
 * route: `cache` dedupes it against the page's own `getProjectStats`, so this
 * costs no extra round trip.
 */
export interface ShellData {
  organizationName: string;
  /** "Free plan", "Pro plan", "Team plan". */
  planLabel: string;
  planIsPaid: boolean;
  userName: string;
  userEmail: string;
  initials: string;
  projectCount: number;
  creditsUsed: number;
  creditsLimit: number;
  /** 0–100, clamped: usage can exceed the limit if a run overshoots. */
  creditsPercentUsed: number;
  /** When the monthly usage window rolls over, e.g. "1 October". */
  creditsResetLabel: string;
  demo: boolean;
}

/**
 * Two letters for the avatar.
 *
 * First and last initial where there is a full name, otherwise the first two
 * letters of the local part of the email — never the hardcoded "TA" that every
 * account used to get.
 */
export function initialsFrom(fullName: string | null | undefined, email: string): string {
  const words = (fullName ?? "").trim().split(/\s+/).filter(Boolean);

  if (words.length >= 2) return (words[0][0] + words[words.length - 1][0]).toUpperCase();
  if (words.length === 1 && words[0].length > 0) return words[0].slice(0, 2).toUpperCase();

  const local = email.split("@")[0] ?? "";
  return (local.slice(0, 2) || "?").toUpperCase();
}

/**
 * The first of next month, which is when the usage window resets.
 *
 * `getProjectStats` sums usage from the first of the current month, so this is
 * derived from the same rule rather than stated separately — the two cannot
 * drift apart into a bar that disagrees with the date beside it.
 */
export function creditsResetLabel(now = new Date()): string {
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return `${next.getDate()} ${next.toLocaleString("en-GB", { month: "long" })}`;
}

export const getShellData = cache(async (): Promise<ShellData | null> => {
  const session = await getSession();
  if (!session) return null;

  const stats = await getProjectStats(session);
  const plan = session.organization.plan ?? "free";

  return {
    organizationName: session.organization.name,
    planLabel: `${plan.charAt(0).toUpperCase()}${plan.slice(1)} plan`,
    planIsPaid: plan !== "free",
    userName: session.user.full_name?.trim() || session.user.email,
    userEmail: session.user.email,
    initials: initialsFrom(session.user.full_name, session.user.email),
    projectCount: stats.projects,
    creditsUsed: stats.aiCreditsUsed,
    creditsLimit: stats.aiCreditsLimit,
    creditsPercentUsed: stats.aiCreditsLimit
      ? Math.min(100, Math.round((stats.aiCreditsUsed / stats.aiCreditsLimit) * 100))
      : 0,
    creditsResetLabel: creditsResetLabel(),
    demo: session.demo,
  };
});
