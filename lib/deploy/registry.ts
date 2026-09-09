import "server-only";

import { createServiceClient } from "@/lib/supabase/server";
import { CloudflareProvider } from "./providers/cloudflare";
import { NetlifyProvider } from "./providers/netlify";
import { VercelProvider } from "./providers/vercel";
import { DeploymentError, type DeploymentProvider, type ProviderKey } from "./types";

/**
 * Resolves a host client for an organization.
 *
 * The token is read with the service role because `deployment_credentials` has
 * no client policy: a deploy token can create and destroy infrastructure, so it
 * must never be reachable from a browser session.
 */
export interface ResolvedProvider {
  provider: DeploymentProvider;
  accountId?: string;
  accountLabel?: string;
}

export async function resolveProvider(
  organizationId: string,
  key: ProviderKey,
): Promise<ResolvedProvider> {
  const supabase = createServiceClient();

  const { data } = await supabase
    .from("deployment_credentials")
    .select("access_token, account_id, account_label, expires_at, revoked_at")
    .eq("organization_id", organizationId)
    .eq("provider", key)
    .is("revoked_at", null)
    .maybeSingle();

  if (!data?.access_token) {
    throw new DeploymentError("unauthorised", `No ${key} account is connected.`, key);
  }

  if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) {
    throw new DeploymentError("unauthorised", `The ${key} connection has expired.`, key);
  }

  const provider = createProvider(key, data.access_token);

  return {
    provider,
    accountId: data.account_id ?? undefined,
    accountLabel: data.account_label ?? undefined,
  };
}

/** Exposed separately so tests can construct a provider with a fake transport. */
export function createProvider(
  key: ProviderKey,
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): DeploymentProvider {
  switch (key) {
    case "vercel":
      return new VercelProvider(accessToken, fetchImpl);
    case "netlify":
      return new NetlifyProvider(accessToken, fetchImpl);
    case "cloudflare":
      return new CloudflareProvider(accessToken, fetchImpl);
  }
}
