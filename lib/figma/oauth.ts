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
 * The app must be PUBLISHED at figma.com/developers/apps, not merely created:
 * Figma changed its developer-platform requirements, and apps registered before
 * that need re-publishing.
 *
 * "OAuth app with client id ... doesn't exist" from the authorize page means
 * exactly what it says — no app with that id is visible to it. Only the
 * authorize page validates a client id, and it needs a signed-in browser, so
 * nothing here can check the value before use. Compare it against the console.
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
 * The scopes this app actually needs, in Figma's current vocabulary.
 *
 * Figma moved to granular scopes and deprecated the older names. `file_read` is
 * deprecated *for OAuth 2 tokens* specifically, and `files:read` is deprecated
 * too — an app registered today carries neither, so asking for either is
 * refused with `{"status":400,"message":"Invalid scopes for app"}` on Figma's
 * own authorize page, before any consent screen and before this app sees a
 * thing.
 *
 * What the client calls, and what each needs:
 *   GET /v1/files/{key}         file contents   -> file_content:read
 *   GET /v1/images/{key}        node renders    -> file_content:read
 *   GET /v1/files/{key}/images  image fills     -> file_content:read
 *   GET /v1/me                  the handle      -> current_user:read
 *
 * Read at request time, not build time, so a correction is an environment
 * change rather than a deploy.
 */
const DEFAULT_SCOPE = "file_content:read current_user:read";

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

/**
 * The scope list, normalised.
 *
 * Figma wants them space-separated. Commas are the obvious thing to type and
 * produce exactly the same opaque 400, so they are accepted and converted.
 */
export function figmaScope(): string {
  const configured = process.env.FIGMA_OAUTH_SCOPE?.trim();
  if (!configured) return DEFAULT_SCOPE;
  return configured.split(/[\s,]+/).filter(Boolean).join(" ") || DEFAULT_SCOPE;
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
  url.searchParams.set("scope", figmaScope());
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
