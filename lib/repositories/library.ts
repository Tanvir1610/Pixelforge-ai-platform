import "server-only";

import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Session } from "@/lib/auth/session";
import type { AssetItem, ComponentEntry, Deployment } from "@/types";
import { ASSETS, COMPONENT_LIBRARY, DEPLOYMENTS } from "@/lib/data";

/**
 * Workspace-wide reads for the library screens.
 *
 * Components, Assets and Deployments rendered fixed sample data unconditionally
 * — six components, ten files, three deploys — so an account that had imported
 * nothing was shown somebody else's work as if it were its own. Each of these
 * has had a real table behind it since Phase 2; nothing was ever wired to them.
 *
 * Everything reads through the user's RLS-scoped client, so the organization
 * filter is a narrowing convenience rather than the boundary.
 *
 * Demo mode still returns the seeded arrays: that is its whole point, and every
 * screen using it shows the demo banner.
 */

/** The org's projects, which every query below is scoped to. */
const projectIdsFor = cache(async (session: Session): Promise<string[]> => {
  const supabase = await createClient();
  if (!supabase) return [];

  const { data } = await supabase
    .from("projects")
    .select("id")
    .eq("organization_id", session.organization.id)
    .is("deleted_at", null);

  return (data ?? []).map((row) => row.id);
});

const ASSET_KINDS: Record<string, AssetItem["kind"]> = {
  image: "Image", icon: "Icon", svg: "SVG", font: "Font", video: "Video",
};

/** Big, unoptimised raster files are the ones worth flagging. */
const OPTIMISE_THRESHOLD_BYTES = 150 * 1024;

export async function listComponents(session: Session): Promise<ComponentEntry[]> {
  if (session.demo) return COMPONENT_LIBRARY;

  const supabase = await createClient();
  if (!supabase) return [];

  const projectIds = await projectIdsFor(session);
  if (projectIds.length === 0) return [];

  const { data: components } = await supabase
    .from("design_components")
    .select("id, name, instance_count")
    .in("project_id", projectIds)
    .order("instance_count", { ascending: false })
    .limit(60);

  if (!components?.length) return [];

  // Variants in one follow-up query rather than an embed: the generated types
  // are hand-maintained, and a join shape is the thing most likely to drift
  // away from them unnoticed.
  const { data: variants } = await supabase
    .from("design_component_variants")
    .select("design_component_id, name")
    .in("design_component_id", components.map((component) => component.id));

  const byComponent = new Map<string, string[]>();
  for (const variant of variants ?? []) {
    const list = byComponent.get(variant.design_component_id) ?? [];
    list.push(variant.name);
    byComponent.set(variant.design_component_id, list);
  }

  return components.map((component) => ({
    id: component.id,
    name: component.name,
    usage: component.instance_count,
    variants: byComponent.get(component.id) ?? [],
  }));
}

export async function listAssets(session: Session): Promise<AssetItem[]> {
  if (session.demo) return ASSETS;

  const supabase = await createClient();
  if (!supabase) return [];

  const projectIds = await projectIdsFor(session);
  if (projectIds.length === 0) return [];

  const { data } = await supabase
    .from("design_assets")
    .select("id, name, kind, bytes, usage_count, optimised_path")
    .in("project_id", projectIds)
    .order("bytes", { ascending: false })
    .limit(200);

  return (data ?? []).map((asset) => ({
    id: asset.id,
    name: asset.name,
    kind: ASSET_KINDS[asset.kind] ?? "Image",
    bytes: asset.bytes,
    uses: asset.usage_count,
    needsOptimising:
      asset.optimised_path === null &&
      asset.bytes > OPTIMISE_THRESHOLD_BYTES &&
      (asset.kind === "image" || asset.kind === "video"),
  }));
}

/**
 * Coarse relative time.
 *
 * The screen wants "2m ago", not a timestamp. Rendered on the server from a
 * stored `created_at`, so it is the same string for everyone looking at it.
 */
export function relativeTime(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

/** Run status to the three states the deployment list renders. */
export function deploymentStatus(status: string): Deployment["status"] {
  if (status === "completed") return "ready";
  if (status === "failed" || status === "cancelled") return "failed";
  return "building";
}

export async function listDeployments(session: Session, limit = 20): Promise<Deployment[]> {
  if (session.demo) return DEPLOYMENTS;

  const supabase = await createClient();
  if (!supabase) return [];

  const projectIds = await projectIdsFor(session);
  if (projectIds.length === 0) return [];

  const { data } = await supabase
    .from("deployment_records")
    .select("id, status, commit_hash, branch, created_at")
    .in("project_id", projectIds)
    .order("created_at", { ascending: false })
    .limit(limit);

  return (data ?? []).map((record) => ({
    id: record.id,
    // A deployment from a generated project has no commit until it is pushed.
    hash: record.commit_hash?.slice(0, 7) ?? "—",
    status: deploymentStatus(record.status),
    branch: record.branch ?? "main",
    time: relativeTime(record.created_at),
  }));
}

export interface AssetTotals {
  count: number;
  bytes: number;
  optimisedBytes: number;
}

/** Header figures for the assets screen, which were a fixed "23 files · 2.1 MB". */
export function assetTotals(assets: AssetItem[]): AssetTotals {
  const bytes = assets.reduce((total, asset) => total + asset.bytes, 0);
  // Assets already optimised keep their size; the rest are estimated at the
  // ~35% saving the pipeline achieves on raster images.
  const optimisedBytes = assets.reduce(
    (total, asset) => total + (asset.needsOptimising ? asset.bytes * 0.65 : asset.bytes),
    0,
  );
  return { count: assets.length, bytes, optimisedBytes: Math.round(optimisedBytes) };
}
