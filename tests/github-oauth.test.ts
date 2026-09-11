import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exchangeGitHubCode, githubRedirectUri, githubScope, isGitHubConfigured } from "@/lib/github/oauth";

/**
 * The token exchange.
 *
 * GitHub reports a failed exchange as HTTP 200 with an `error` field, not as a
 * 4xx. A handler that only checks `response.ok` — which is what the shared host
 * exchange does — reads a successful response with no access token and reports
 * something misleading. That is the behaviour these pin.
 */
const ORIGIN = "https://example.test";

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  process.env.GITHUB_CLIENT_ID = "Iv1.test";
  process.env.GITHUB_CLIENT_SECRET = "secret";
  delete process.env.GITHUB_OAUTH_SCOPE;
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleError.mockRestore();
  delete process.env.GITHUB_CLIENT_ID;
  delete process.env.GITHUB_CLIENT_SECRET;
  delete process.env.GITHUB_OAUTH_SCOPE;
});

/** Captures the request and replies with whatever the case under test needs. */
function reply(status: number, body: unknown) {
  const sent: { url?: string; headers?: Record<string, string>; body?: string } = {};
  const impl = (async (url: string | URL, init?: RequestInit) => {
    sent.url = String(url);
    sent.headers = init?.headers as Record<string, string>;
    sent.body = String(init?.body ?? "");
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { impl, sent };
}

describe("exchangeGitHubCode", () => {
  it("posts to GitHub's token endpoint with the app's credentials", async () => {
    const { impl, sent } = reply(200, { access_token: "gho_x", scope: "repo", token_type: "bearer" });
    await exchangeGitHubCode({ code: "abc", origin: ORIGIN, fetchImpl: impl });

    expect(sent.url).toBe("https://github.com/login/oauth/access_token");
    const params = new URLSearchParams(sent.body);
    expect(params.get("client_id")).toBe("Iv1.test");
    expect(params.get("client_secret")).toBe("secret");
    expect(params.get("code")).toBe("abc");
    expect(params.get("redirect_uri")).toBe(`${ORIGIN}/api/connect/github/callback`);
  });

  /**
   * Without this header GitHub replies in form-urlencoded, and parsing it as
   * JSON throws on a response that actually succeeded.
   */
  it("asks for JSON explicitly", async () => {
    const { impl, sent } = reply(200, { access_token: "gho_x" });
    await exchangeGitHubCode({ code: "abc", origin: ORIGIN, fetchImpl: impl });

    expect(sent.headers?.Accept).toBe("application/json");
  });

  it("returns the token and the scope GitHub actually granted", async () => {
    const { impl } = reply(200, { access_token: "gho_x", scope: "repo,read:user", token_type: "bearer" });
    const token = await exchangeGitHubCode({ code: "abc", origin: ORIGIN, fetchImpl: impl });

    expect(token.accessToken).toBe("gho_x");
    expect(token.scope).toBe("repo,read:user");
  });

  /** The whole point: a 200 carrying `error` is a failure. */
  it("treats a 200 with an error field as a failure", async () => {
    const { impl } = reply(200, {
      error: "bad_verification_code",
      error_description: "The code passed is incorrect or expired.",
    });

    await expect(exchangeGitHubCode({ code: "spent", origin: ORIGIN, fetchImpl: impl })).rejects.toThrow(
      "bad_verification_code",
    );
  });

  /**
   * The two failures that look identical from outside and need opposite fixes.
   * The slug is carried through so the callback can say which one it was.
   */
  it("carries the slug through, so a redirect mismatch is distinguishable", async () => {
    const { impl } = reply(200, { error: "redirect_uri_mismatch" });

    await expect(exchangeGitHubCode({ code: "abc", origin: ORIGIN, fetchImpl: impl })).rejects.toThrow(
      "redirect_uri_mismatch",
    );
  });

  it("does not mistake a successful response with no token for a token", async () => {
    const { impl } = reply(200, { token_type: "bearer" });
    await expect(exchangeGitHubCode({ code: "abc", origin: ORIGIN, fetchImpl: impl })).rejects.toThrow(
      /did not return an access token/i,
    );
  });

  /**
   * Classic OAuth App tokens never expire. Inventing an expiry would revoke a
   * working connection at an arbitrary moment.
   */
  it("leaves the expiry unset when GitHub reports none", async () => {
    const { impl } = reply(200, { access_token: "gho_x" });
    const token = await exchangeGitHubCode({ code: "abc", origin: ORIGIN, fetchImpl: impl });

    expect(token.expiresAt).toBeUndefined();
    expect(token.refreshToken).toBeUndefined();
  });

  it("records the expiry when the app has expiring tokens enabled", async () => {
    const { impl } = reply(200, {
      access_token: "ghu_x", refresh_token: "ghr_x", expires_in: 28_800,
    });
    const token = await exchangeGitHubCode({ code: "abc", origin: ORIGIN, fetchImpl: impl });

    expect(token.refreshToken).toBe("ghr_x");
    expect(new Date(token.expiresAt!).getTime()).toBeGreaterThan(Date.now());
  });

  it("refuses to exchange at all when the app is not configured", async () => {
    delete process.env.GITHUB_CLIENT_ID;
    const { impl } = reply(200, { access_token: "gho_x" });

    await expect(exchangeGitHubCode({ code: "abc", origin: ORIGIN, fetchImpl: impl })).rejects.toThrow(
      /not configured/i,
    );
  });
});

describe("configuration", () => {
  it("needs both halves before it counts as configured", () => {
    expect(isGitHubConfigured()).toBe(true);
    delete process.env.GITHUB_CLIENT_SECRET;
    expect(isGitHubConfigured()).toBe(false);
  });

  /** Asked for by default: `repo` is what allows creating and pushing. */
  it("defaults to a scope that can actually push", () => {
    expect(githubScope()).toBe("repo read:user");
  });

  it("lets the scope be corrected without a deploy", () => {
    process.env.GITHUB_OAUTH_SCOPE = "public_repo read:user";
    expect(githubScope()).toBe("public_repo read:user");
  });

  /**
   * Built in one place and used both in the authorize URL and the exchange.
   * GitHub matches it exactly, and a mismatch is the likeliest failure.
   */
  it("builds the redirect URI the same way every time", () => {
    expect(githubRedirectUri(ORIGIN)).toBe("https://example.test/api/connect/github/callback");
  });
});
