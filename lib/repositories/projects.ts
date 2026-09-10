import "server-only";

import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { ProjectRow } from "@/lib/db/database.types";
import { DEMO_PROJECTS } from "@/lib/demo";
import type { Session } from "@/lib/auth/session";
import { toSlug } from "@/lib/validation/schemas";
import type { CreateProjectInput } from "@/lib/validation/schemas";

export interface ProjectStats {
  projects: number;
  generations: number;
  deployments: number;
  aiCreditsUsed: number;
  aiCreditsLimit: number;
}

/**
 * Data access for projects.
 *
 * Reads go through the user's RLS-scoped client, so the organization filter
 * below is a narrowing convenience, not the security boundary — a caller who
 * omitted it would still only ever see their own rows.
 */
export async function listProjects(session: Session, limit = 12): Promise<ProjectRow[]> {
  if (session.demo) return DEMO_PROJECTS.slice(0, limit);

  const supabase = await createClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("organization_id", session.organization.id)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`Could not load projects: ${error.message}`);
  return data ?? [];
}

export async function getProjectBySlug(session: Session, slug: string): Promise<ProjectRow | null> {
  if (session.demo) return DEMO_PROJECTS.find((project) => project.slug === slug) ?? null;

  const supabase = await createClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("organization_id", session.organization.id)
    .eq("slug", slug)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) throw new Error(`Could not load project: ${error.message}`);
  return data;
}

export async function createProject(session: Session, input: CreateProjectInput): Promise<ProjectRow> {
  if (session.demo) throw new Error("Connect Supabase to create real projects.");

  const supabase = await createClient();
  if (!supabase) throw new Error("Supabase is not configured.");

  const { data, error } = await supabase
    .from("projects")
    .insert({
      organization_id: session.organization.id,
      name: input.name,
      slug: toSlug(input.name),
      framework: input.framework,
      styling: input.styling,
      typescript: input.typescript,
      responsive: input.responsive,
      host_provider: input.hostProvider,
      created_by: session.user.id,
      status: "draft",
    })
    .select("*")
    .single();

  // A policy violation surfaces as 42501; translate it rather than leaking SQL.
  if (error) {
    if (error.code === "42501") throw new Error("You do not have permission to create projects here.");
    throw new Error(`Could not create the project: ${error.message}`);
  }
  return data;
}

/**
 * Workspace totals.
 *
 * `cache` dedupes it across a render pass: the dashboard page and the sidebar
 * both need these figures, and without it they would issue the same two queries
 * twice — and could disagree if a write landed between them.
 */
export const getProjectStats = cache(async (session: Session): Promise<ProjectStats> => {
  const limit = session.organization.ai_credits_limit;

  if (session.demo) {
    return { projects: DEMO_PROJECTS.length, generations: 37, deployments: 21, aiCreditsUsed: 1240, aiCreditsLimit: limit };
  }

  const supabase = await createClient();
  if (!supabase) return { projects: 0, generations: 0, deployments: 0, aiCreditsUsed: 0, aiCreditsLimit: limit };

  const since = new Date();
  since.setDate(1);
  since.setHours(0, 0, 0, 0);

  const [projects, usage] = await Promise.all([
    supabase
      .from("projects")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", session.organization.id)
      .is("deleted_at", null),
    // Usage is always summed from usage_records server-side; a client-supplied
    // figure is never trusted.
    supabase
      .from("usage_records")
      .select("metric, quantity")
      .eq("organization_id", session.organization.id)
      .gte("occurred_at", since.toISOString()),
  ]);

  const totals = (usage.data ?? []).reduce<Record<string, number>>((acc, row) => {
    acc[row.metric] = (acc[row.metric] ?? 0) + Number(row.quantity);
    return acc;
  }, {});

  return {
    projects: projects.count ?? 0,
    generations: Math.round(totals.generations ?? 0),
    deployments: Math.round(totals.deployments ?? 0),
    aiCreditsUsed: Math.round(totals.ai_credits ?? 0),
    aiCreditsLimit: limit,
  };
});
