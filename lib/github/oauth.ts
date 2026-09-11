import "server-only";

import { randomBytes } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/server";
import { getViewer } from "./client";

/**
 * Connecting a GitHub account.
 *
 * The state token is generated server-side, stored, and consumed exactly once
 * through the same `oauth_states` table the host and Figma flows use — without
 * it, someone can complete a callback against a victim's session and attach
 * their own GitHub account to the victim's organization, which would then
 * receive that organization's code.
 */
const AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const TOKEN_URL = "https://github.com/login/oauth/access_token";

/**
 * What the connection needs to be able to do.
 *
 * `repo` covers creating a repository and pushing to private ones; `read:user`
 * is what names the connected account. Overridable, because the Figma
 * integration proved that a scope string guessed from memory costs a day —
 * if GitHub changes what these are called, this can be fixed without a deploy.
 */
export function githubScope(): string {
  return process.env.GITHUB_OAUTH_SCOPE?.trim() || "repo read:user";
}

export class GitHubNotConfiguredError extends Error {
  constructor() {
    super("GitHub OAuth is not configured. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET.");
    this.name = "GitHubNotConfiguredError";
  }
}

export function isGitHubConfigured(): boolean {
  return Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);
}

function credentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new GitHubNotConfiguredError();
  return { clientId, clientSecret };
}

/** The exact URI GitHub must have registered. Built in one place, used in both. */
export function githubRedirectUri(origin: string): string {
  return `${origin}/api/connect/github/callback`;
}

export async function beginGitHubConnect(params: {
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
    provider: "github",
    redirect_path: params.redirectPath ?? "/dashboard/settings",
  });
  if (error) throw new Error("Could not start the connection.");

  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", githubRedirectUri(params.origin));
  url.searchParams.set("scope", githubScope());
  url.searchParams.set("state", state);

  return url.toString();
}

export interface GitHubToken {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  scope?: string;
}

/**
 * Exchanges the code for a token.
 *
 * The trap here, and the reason this is not the shared `exchangeCode`: GitHub
 * reports a failed exchange as **HTTP 200** with an `error` field in the body.
 * A handler that only checks `response.ok` reads a successful response with no
 * `access_token` and reports something misleading — which is exactly what the
 * generic host exchange would have done. The body is checked first.
 */
export async function exchangeGitHubCode(params: {
  code: string;
  origin: string;
  fetchImpl?: typeof fetch;
}): Promise<GitHubToken> {
  const { clientId, clientSecret } = credentials();
  const fetchImpl = params.fetchImpl ?? fetch;

  const response = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      // Without this GitHub replies in form-urlencoded, and JSON.parse throws
      // on a response that actually succeeded.
      Accept: "application/json",
      "User-Agent": "PixelForge-AI",
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code: params.code,
      redirect_uri: githubRedirectUri(params.origin),
    }).toString(),
  });

  let body: Record<string, unknown> = {};
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    throw new Error("GitHub's reply to the token exchange could not be read.");
  }

  if (typeof body.error === "string") {
    // Logged with GitHub's own wording, which names the actual cause —
    // redirect_uri_mismatch and bad_verification_code look identical from here
    // otherwise, and they need completely different fixes.
    console.error("[github:oauth]", body.error, body.error_description ?? "");
    throw new Error(String(body.error));
  }

  if (!response.ok) {
    throw new Error(`GitHub rejected the token exchange (${response.status}).`);
  }

  const accessToken = body.access_token;
  if (typeof accessToken !== "string" || !accessToken) {
    throw new Error("GitHub did not return an access token.");
  }

  const expiresIn = typeof body.expires_in === "number" ? body.expires_in : undefined;

  return {
    accessToken,
    refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : undefined,
    // Classic OAuth App tokens do not expire, so this stays null rather than
    // being invented — a made-up expiry would revoke a working connection.
    expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : undefined,
    scope: typeof body.scope === "string" ? body.scope : undefined,
  };
}

/** Stores the connection. Service role only — this table has no client policy. */
export async function saveGitHubConnection(params: {
  organizationId: string;
  userId: string;
  token: GitHubToken;
  tokenKind: "oauth" | "personal";
  fetchImpl?: typeof fetch;
}): Promise<{ login: string }> {
  // Identified from the token rather than trusted from the flow: this is the
  // account the pushes will be attributed to, so it should be the account the
  // token actually belongs to.
  const viewer = await getViewer(params.token.accessToken, params.fetchImpl);

  const supabase = createServiceClient();
  const { error } = await supabase.from("github_connections").upsert(
    {
      organization_id: params.organizationId,
      user_id: params.userId,
      github_user_id: String(viewer.id),
      github_login: viewer.login,
      access_token: params.token.accessToken,
      refresh_token: params.token.refreshToken ?? null,
      expires_at: params.token.expiresAt ?? null,
      token_kind: params.tokenKind,
      scope: params.token.scope ?? null,
      revoked_at: null,
    },
    { onConflict: "organization_id,user_id" },
  );

  if (error) throw new Error(`Could not save the GitHub connection: ${error.message}`);
  return { login: viewer.login };
}
