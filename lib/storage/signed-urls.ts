import "server-only";

import { createClient } from "@/lib/supabase/server";

export type Bucket =
  | "figma-assets" | "project-assets" | "generated-assets" | "screenshots" | "build-artifacts" | "avatars";

const DEFAULT_TTL_SECONDS = 300;

/**
 * Signed URL for a private object.
 *
 * All buckets are private, so this is the only way a client sees an asset.
 * Storage policies resolve the owning project from the first path segment, so
 * every path must be `{project_id}/…` — enforced here rather than trusted.
 */
export async function getSignedUrl(
  bucket: Bucket,
  path: string,
  expiresIn = DEFAULT_TTL_SECONDS,
): Promise<string | null> {
  if (bucket !== "avatars" && !/^[0-9a-f-]{36}\//i.test(path)) {
    throw new Error(`Storage path must start with a project id: received "${path}".`);
  }

  const supabase = await createClient();
  if (!supabase) return null;

  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresIn);
  if (error) return null;
  return data.signedUrl;
}

/** Batched variant, so a grid of assets is one round trip. */
export async function getSignedUrls(
  bucket: Bucket,
  paths: string[],
  expiresIn = DEFAULT_TTL_SECONDS,
): Promise<Record<string, string>> {
  const supabase = await createClient();
  if (!supabase || paths.length === 0) return {};

  const { data, error } = await supabase.storage.from(bucket).createSignedUrls(paths, expiresIn);
  if (error || !data) return {};

  const result: Record<string, string> = {};
  for (const entry of data) {
    if (entry.path && entry.signedUrl) result[entry.path] = entry.signedUrl;
  }
  return result;
}

/** Canonical object key. Keeping this in one place is what makes RLS work. */
export function assetPath(projectId: string, ...segments: string[]): string {
  const safe = segments.map((segment) => segment.replace(/[^a-zA-Z0-9._-]/g, "_"));
  return [projectId, ...safe].join("/");
}
