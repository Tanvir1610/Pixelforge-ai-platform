import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { OrganizationRow, OrgRole, ProfileRow } from "@/lib/db/database.types";
import { DEMO_ORGANIZATION, DEMO_PROFILE } from "@/lib/demo";
import { isSupabaseConfigured } from "@/lib/supabase/env";

export interface Session {
  user: ProfileRow;
  organization: OrganizationRow;
  role: OrgRole;
  /** True when Supabase is not configured and seeded data is being served. */
  demo: boolean;
}

/**
 * Resolves the signed-in user, their active organization and their role.
 *
 * `cache` dedupes this across a render pass, so a layout and three nested
 * server components share one round trip instead of four.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  if (!isSupabaseConfigured()) {
    return { user: DEMO_PROFILE, organization: DEMO_ORGANIZATION, role: "owner", demo: true };
  }

  const supabase = await createClient();
  if (!supabase) return null;

  // getUser() revalidates the JWT against Supabase. getSession() only reads the
  // cookie, which a client could have tampered with, so it is not used here.
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", auth.user.id)
    .single();
  if (!profile) return null;

  const { data: membership } = await supabase
    .from("organization_members")
    .select("role, organization_id, organizations(*)")
    .eq("user_id", auth.user.id)
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle<{ role: OrgRole; organization_id: string; organizations: OrganizationRow }>();

  if (!membership?.organizations) return null;

  return { user: profile, organization: membership.organizations, role: membership.role, demo: false };
});

/** Route guard for anything under /dashboard and /project. */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

const ROLE_RANK: Record<OrgRole, number> = {
  owner: 50, admin: 40, developer: 30, designer: 20, viewer: 10,
};

export function hasOrgRole(session: Session, minimum: OrgRole): boolean {
  return ROLE_RANK[session.role] >= ROLE_RANK[minimum];
}

/**
 * Server-side role gate. This mirrors the database policy rather than replacing
 * it — RLS remains the real boundary, this exists to fail fast with a clear
 * message instead of returning an empty result set.
 */
export async function requireOrgRole(minimum: OrgRole): Promise<Session> {
  const session = await requireSession();
  if (!hasOrgRole(session, minimum)) {
    throw new Error(`This action requires the ${minimum} role or higher.`);
  }
  return session;
}
