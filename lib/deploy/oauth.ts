import "server-only";

import { randomBytes } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/server";
import type { ProviderKey } from "./types";

/**
 * Host OAuth connect flows.
 *
 * The state token is generated server-side, stored, and consumed exactly once.
 * Without it an attacker can complete a callback against a victim's session and
 * attach their own host account to the victim's organization — the connected
 * account would then receive that organization's deployments.
 */
interface ProviderOauthConfig {
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
  clientIdEnv: string;
  clientSecretEnv: string;
}

const CONFIG: Record<ProviderKey, ProviderOauthConfig> = {
  vercel: {
    authorizeUrl: "https://vercel.com/integrations/pixelforge/new",
    tokenUrl: "https://api.vercel.com/v2/oauth/access_token",
    scopes: [],
    clientIdEnv: "VERCEL_CLIENT_ID",
    clientSecretEnv: "VERCEL_CLIENT_SECRET",
  },
  netlify: {
    authorizeUrl: "https://app.netlify.com/authorize",
    tokenUrl: "https://api.netlify.com/oauth/token",
    scopes: [],
    clientIdEnv: "NETLIFY_CLIENT_ID",
    clientSecretEnv: "NETLIFY_CLIENT_SECRET",
  },
  cloudflare: {
    authorizeUrl: "https://dash.cloudflare.com/oauth2/auth",
    tokenUrl: "https://dash.cloudflare.com/oauth2/token",
    scopes: ["account:read", "pages:write"],
    clientIdEnv: "CLOUDFLARE_CLIENT_ID",
    clientSecretEnv: "CLOUDFLARE_CLIENT_SECRET",
  },
};

export class OauthNotConfiguredError extends Error {
  constructor(provider: ProviderKey) {
    super(`${provider} OAuth is not configured. Set its client id and secret.`);
    this.name = "OauthNotConfiguredError";
  }
}

function credentials(provider: ProviderKey): { clientId: string; clientSecret: string } {
  const config = CONFIG[provider];
  const clientId = process.env[config.clientIdEnv];
  const clientSecret = process.env[config.clientSecretEnv];
  if (!clientId || !clientSecret) throw new OauthNotConfiguredError(provider);
  return { clientId, clientSecret };
}

/** Builds the authorize URL and records the one-time state. */
export async function beginConnect(params: {
  provider: ProviderKey;
  organizationId: string;
  userId: string;
  origin: string;
  redirectPath?: string;
}): Promise<string> {
  const config = CONFIG[params.provider];
  const { clientId } = credentials(params.provider);

  // 32 bytes of CSPRNG. A guessable state defeats the whole mechanism.
  const state = randomBytes(32).toString("base64url");

  const supabase = createServiceClient();
  const { error } = await supabase.from("oauth_states").insert({
    state,
    organization_id: params.organizationId,
    user_id: params.userId,
    provider: params.provider,
    redirect_path: params.redirectPath ?? "/dashboard/deployments",
  });

  if (error) throw new Error("Could not start the connection.");

  const url = new URL(config.authorizeUrl);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", `${params.origin}/api/connect/${params.provider}/callback`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  if (config.scopes.length) url.searchParams.set("scope", config.scopes.join(" "));

  return url.toString();
}

export interface ConnectContext {
  organizationId: string;
  userId: string;
  /**
   * Widened beyond the host providers because the same one-time state table
   * backs the Figma connect flow — the mechanism is identical and duplicating
   * it would mean two places to get the replay handling right.
   */
  provider: ProviderKey | "figma";
  redirectPath: string;
}

/**
 * Validates the returned state.
 *
 * Consumed atomically in Postgres, so a replayed callback finds nothing. An
 * unknown, expired or already-used state is rejected without distinguishing
 * between them — the difference is only useful to an attacker.
 */
export async function consumeState(state: string): Promise<ConnectContext | null> {
  if (!state || state.length < 16) return null;

  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("consume_oauth_state", { p_state: state });

  if (error || !data || data.length === 0) return null;

  const row = data[0];
  return {
    organizationId: row.organization_id,
    userId: row.user_id,
    provider: row.provider as ProviderKey | "figma",
    redirectPath: row.redirect_path,
  };
}

export interface TokenResponse {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  accountId?: string;
  accountLabel?: string;
}

/** Exchanges the code for a token. Hosts differ in field names and shape. */
export async function exchangeCode(params: {
  provider: ProviderKey;
  code: string;
  origin: string;
  fetchImpl?: typeof fetch;
}): Promise<TokenResponse> {
  const config = CONFIG[params.provider];
  const { clientId, clientSecret } = credentials(params.provider);
  const fetchImpl = params.fetchImpl ?? fetch;

  const response = await fetchImpl(config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code: params.code,
      redirect_uri: `${params.origin}/api/connect/${params.provider}/callback`,
      grant_type: "authorization_code",
    }).toString(),
  });

  if (!response.ok) {
    throw new Error("The host rejected the connection. Try connecting again.");
  }

  const body = (await response.json()) as Record<string, unknown>;
  const accessToken = body.access_token;
  if (typeof accessToken !== "string" || !accessToken) {
    throw new Error("The host did not return an access token.");
  }

  const expiresIn = typeof body.expires_in === "number" ? body.expires_in : undefined;

  return {
    accessToken,
    refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : undefined,
    expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : undefined,
    // Vercel returns team_id; Cloudflare returns an account scope.
    accountId:
      typeof body.team_id === "string" ? body.team_id
      : typeof body.account_id === "string" ? body.account_id
      : undefined,
    accountLabel: typeof body.account_name === "string" ? body.account_name : undefined,
  };
}

/** Stores the credential. Service role only — this table has no client policy. */
export async function saveCredential(params: {
  organizationId: string;
  provider: ProviderKey;
  userId: string;
  token: TokenResponse;
}): Promise<void> {
  const supabase = createServiceClient();

  await supabase.from("deployment_credentials").upsert(
    {
      organization_id: params.organizationId,
      provider: params.provider,
      access_token: params.token.accessToken,
      refresh_token: params.token.refreshToken ?? null,
      expires_at: params.token.expiresAt ?? null,
      account_id: params.token.accountId ?? null,
      account_label: params.token.accountLabel ?? null,
      created_by: params.userId,
      revoked_at: null,
    },
    { onConflict: "organization_id,provider" },
  );
}

/** Same-origin relative paths only, so a callback cannot bounce off-site. */
export function safeRedirect(path: string, fallback = "/dashboard/deployments"): string {
  return path.startsWith("/") && !path.startsWith("//") ? path : fallback;
}

/**
 * The origin to build redirect URIs and redirects from.
 *
 * `new URL(request.url).origin` reflects the Host header, which a proxy will
 * pass through unchanged. That origin was being sent to the host as the OAuth
 * `redirect_uri` and used as the base of the browser redirect after the
 * exchange, so a spoofed Host turned the callback into an open redirect. When
 * `NEXT_PUBLIC_APP_URL` is configured it is authoritative; the request origin is
 * the fallback for local development, where there is no proxy to lie.
 */
export function appOrigin(requestOrigin: string): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (!configured) return requestOrigin;

  try {
    return new URL(configured).origin;
  } catch {
    return requestOrigin;
  }
}
