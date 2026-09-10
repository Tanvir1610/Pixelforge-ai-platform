import "server-only";

import { randomBytes } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * Figma connect flow.
 *
 * The "Connect Figma" button had no handler at all — the table, the read path
 * and the token column all existed, and nothing had ever written to them. This
 * is the missing half.
 *
 * Same shape as the host-connect flow in lib/deploy/oauth.ts, and it reuses the
 * same one-time `oauth_states` row: without it an attacker can complete a
 * callback against a victim's session and attach their own Figma account to the
 * victim's organization, which would then read that account's files.
 */
const AUTHORIZE_URL = "https://www.figma.com/oauth";
const TOKEN_URL = "https://api.figma.com/v1/oauth/token";
const ME_URL = "https://api.figma.com/v1/me";

/**
 * Figma renamed its scopes; older apps are still registered against the legacy
 * name. Configurable so a mismatch is a setting rather than a code change.
 */
const DEFAULT_SCOPE = "files:read";

export class FigmaOauthNotConfiguredError extends Error {
  constructor() {
    super("Figma OAuth is not configured. Set FIGMA_CLIENT_ID and FIGMA_CLIENT_SECRET.");
    this.name = "FigmaOauthNotConfiguredError";
  }
}

export function isFigmaOauthConfigured(): boolean {
  return Boolean(process.env.FIGMA_CLIENT_ID && process.env.FIGMA_CLIENT_SECRET);
}

function credentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.FIGMA_CLIENT_ID;
  const clientSecret = process.env.FIGMA_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new FigmaOauthNotConfiguredError();
  return { clientId, clientSecret };
}

export function figmaRedirectUri(origin: string): string {
  return `${origin}/api/connect/figma/callback`;
}

/** Builds the authorize URL and records the one-time state. */
export async function beginFigmaConnect(params: {
  organizationId: string;
  userId: string;
  origin: string;
  redirectPath?: string;
}): Promise<string> {
  const { clientId } = credentials();

  // 32 bytes of CSPRNG. A guessable state defeats the whole mechanism.
  const state = randomBytes(32).toString("base64url");

  const supabase = createServiceClient();
  const { error } = await supabase.from("oauth_states").insert({
    state,
    organization_id: params.organizationId,
    user_id: params.userId,
    provider: "figma",
    redirect_path: params.redirectPath ?? "/dashboard/import",
  });

  if (error) throw new Error("Could not start the Figma connection.");

  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", figmaRedirectUri(params.origin));
  url.searchParams.set("scope", process.env.FIGMA_OAUTH_SCOPE ?? DEFAULT_SCOPE);
  url.searchParams.set("state", state);
  url.searchParams.set("response_type", "code");

  return url.toString();
}

export interface FigmaToken {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  figmaUserId: string;
  handle?: string;
}

/**
 * Exchanges the code for a token, then resolves who it belongs to.
 *
 * `figma_connections.figma_user_id` is NOT NULL, and the token response does
 * not always carry it, so `/v1/me` is the reliable source. It also gives the
 * handle, which is the only thing the UI can show about a connection — the
 * token itself is never readable from a browser session.
 */
export async function exchangeFigmaCode(params: {
  code: string;
  origin: string;
  fetchImpl?: typeof fetch;
}): Promise<FigmaToken> {
  const { clientId, clientSecret } = credentials();
  const fetchImpl = params.fetchImpl ?? fetch;

  const response = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: {
      // Figma takes the client credentials as HTTP Basic on this endpoint.
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      redirect_uri: figmaRedirectUri(params.origin),
      code: params.code,
      grant_type: "authorization_code",
    }).toString(),
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) throw new Error("Figma rejected the connection. Try connecting again.");

  const body = (await response.json()) as Record<string, unknown>;
  const accessToken = body.access_token;
  if (typeof accessToken !== "string" || !accessToken) {
    throw new Error("Figma did not return an access token.");
  }

  const expiresIn = typeof body.expires_in === "number" ? body.expires_in : undefined;

  let figmaUserId = typeof body.user_id === "string" ? body.user_id : "";
  let handle: string | undefined;

  const me = await fetchImpl(ME_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(20_000),
  });

  if (me.ok) {
    const profile = (await me.json()) as { id?: string; handle?: string; email?: string };
    if (profile.id) figmaUserId = profile.id;
    handle = profile.handle ?? profile.email;
  }

  if (!figmaUserId) throw new Error("Figma did not identify the connected account.");

  return {
    accessToken,
    refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : undefined,
    expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : undefined,
    figmaUserId,
    handle,
  };
}

/** Stores the connection. Service role only — this table has no client policy. */
export async function saveFigmaConnection(params: {
  organizationId: string;
  userId: string;
  token: FigmaToken;
}): Promise<void> {
  const supabase = createServiceClient();

  const { error } = await supabase.from("figma_connections").upsert(
    {
      organization_id: params.organizationId,
      user_id: params.userId,
      figma_user_id: params.token.figmaUserId,
      figma_handle: params.token.handle ?? null,
      access_token: params.token.accessToken,
      refresh_token: params.token.refreshToken ?? null,
      expires_at: params.token.expiresAt ?? null,
      // Reconnecting after a revoke has to clear it, or the connection stays
      // dead while looking alive.
      revoked_at: null,
    },
    { onConflict: "organization_id,user_id" },
  );

  if (error) throw new Error(`Could not save the Figma connection: ${error.message}`);
}
