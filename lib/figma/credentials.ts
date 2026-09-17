import "server-only";

import { createServiceClient } from "@/lib/supabase/server";

/**
 * Resolves the Figma credential for this organization.
 *
 * Reads `figma_connections` with the service role because that table has no
 * client policy at all — a browser session can learn that a connection exists,
 * never the token. Falls back to a personal access token in development.
 *
 * Shared by import and generation: generation renders the imported frames to
 * images, which needs the same token the import used.
 */
export async function resolveFigmaToken(
  organizationId: string,
): Promise<{ accessToken: string; tokenKind: "oauth" | "personal" } | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("figma_connections")
    .select("access_token, expires_at, revoked_at, token_kind")
    .eq("organization_id", organizationId)
    .is("revoked_at", null)
    .limit(1)
    .maybeSingle();

  if (data?.access_token) {
    const expired = data.expires_at ? new Date(data.expires_at).getTime() < Date.now() : false;
    // The kind is read, not assumed: OAuth sends a bearer and a personal token
    // sends X-Figma-Token, and the wrong one comes back as a bare 401.
    if (!expired) return { accessToken: data.access_token, tokenKind: data.token_kind ?? "oauth" };
  }

  const personal = process.env.FIGMA_PERSONAL_ACCESS_TOKEN;
  if (personal) return { accessToken: personal, tokenKind: "personal" };

  return null;
}
