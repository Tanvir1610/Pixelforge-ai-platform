import { NextResponse } from "next/server";
import { getPublicEnv, SupabaseConfigError } from "@/lib/supabase/env";
import { isUpiConfigured } from "@/lib/payments/upi";
import { figmaRedirectUri, figmaScope } from "@/lib/figma/oauth";
import { githubRedirectUri, githubScope } from "@/lib/github/oauth";

/**
 * Deployment diagnostics.
 *
 * "Accounts can't be created" has one cause almost every time — a variable that
 * is missing, misnamed, scoped to the wrong environment, or set after the build
 * that needed it — and none of that is visible from outside. Working it out by
 * poking at redirect behaviour is slow and inconclusive.
 *
 * This reports whether each variable is *present*, never what it contains. The
 * two `NEXT_PUBLIC_` ones are additionally interesting for *when* they were
 * present: Next.js inlines them at build time, so a false here on a variable you
 * have definitely set means the build predates it and a redeploy is needed.
 *
 * Booleans and lengths only. A length is enough to spot a truncated paste and
 * useless for anything else.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function describe(value: string | undefined) {
  const trimmed = value?.trim() ?? "";
  return { set: trimmed.length > 0, length: trimmed.length };
}

/**
 * Actually call the API rather than checking that a string is non-empty.
 *
 * `usable: true` meaning "the variable is set" is what let a completely
 * unusable configuration look healthy — a stale model id, a removed parameter
 * and an org-scoped key with no workspace all sat behind a green tick. GET
 * /v1/models costs nothing, needs no model id, and exercises exactly the two
 * things that were wrong: the credential and the workspace header.
 */
async function probeInference(): Promise<{ reachable: boolean; problem: string | null }> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return { reachable: false, problem: "ANTHROPIC_API_KEY is not set." };

  const workspaceId = process.env.ANTHROPIC_WORKSPACE_ID?.trim();

  try {
    const response = await fetch("https://api.anthropic.com/v1/models?limit=1", {
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        ...(workspaceId ? { "anthropic-workspace-id": workspaceId } : {}),
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (response.ok) return { reachable: true, problem: null };

    const body = await response.text().catch(() => "");
    let message = `HTTP ${response.status}`;
    try {
      message = (JSON.parse(body) as { error?: { message?: string } }).error?.message ?? message;
    } catch {
      // Not JSON; the status stands.
    }
    // The API's own words. They name headers and parameters, never secrets.
    return { reachable: false, problem: message.slice(0, 300) };
  } catch (error) {
    return {
      reachable: false,
      problem: error instanceof Error ? `Could not reach the API: ${error.message}` : "Could not reach the API.",
    };
  }
}

/**
 * There is no server-side way to validate a Figma client id.
 *
 * An earlier version of this file posted an invalid authorization code to the
 * token endpoint and read `invalid_grant` as "the client credentials were
 * accepted". That was wrong: Figma validates the code first and returns
 * `invalid_grant` for a completely fabricated id and secret as well, so the
 * response carries no information about the credentials at all.
 *
 * The authorize endpoint is the only thing that checks the client id, and it
 * requires a signed-in browser — it redirects to the login page otherwise, so a
 * server cannot reach the check. The configured id is therefore reported as-is
 * for comparison against figma.com/developers/apps, which is the only reliable
 * way to tell whether it is the id of a real, published app.
 *
 * The client id is not a secret: it travels in every authorize URL.
 */

export async function GET() {
  // Inlined at build time. A false means the build did not have it.
  const url = describe(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const anonKey = describe(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const appUrl = describe(process.env.NEXT_PUBLIC_APP_URL);

  // Read at runtime, so this one reflects the current settings, not the build.
  const serviceKey = describe(process.env.SUPABASE_SERVICE_ROLE_KEY);

  const inference = await probeInference();

  let configured = false;
  let problem: string | null = null;

  try {
    configured = getPublicEnv() !== null;
    if (!configured) problem = "Neither Supabase variable is set — the app is serving demo data.";
  } catch (error) {
    // Names the offending variable and carries no value.
    problem = error instanceof SupabaseConfigError ? error.message : "Configuration could not be read.";
  }

  const hint =
    problem === null
      ? null
      : url.set !== anonKey.set
        ? "One of the two NEXT_PUBLIC_SUPABASE_* variables is missing. Both are needed, and the anon key must carry the NEXT_PUBLIC_ prefix."
        : !url.set && !anonKey.set && serviceKey.set
          ? "The service-role key is visible but neither NEXT_PUBLIC_ variable is. NEXT_PUBLIC_ values are inlined at build time, so this is what a deployment looks like when the variables were added after the last build, or scoped to a different environment. Redeploy."
          : "Set both NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY, then redeploy.";

  // Payments have the same failure mode as Supabase did: a button that reports
  // "not configured" and no way from outside to see which variable is missing.
  const upi = {
    payeeVpa: describe(process.env.UPI_PAYEE_VPA),
    payeeName: describe(process.env.UPI_PAYEE_NAME),
    operators: describe(process.env.PLATFORM_ADMIN_EMAILS),
    // False when a variable is missing *or* the VPA is malformed, which are
    // different problems with the same symptom.
    usable: isUpiConfigured(),
  };

  const razorpay = {
    keyId: describe(process.env.RAZORPAY_KEY_ID),
    publicKeyId: describe(process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID),
    keySecret: describe(process.env.RAZORPAY_KEY_SECRET),
    webhookSecret: describe(process.env.RAZORPAY_WEBHOOK_SECRET),
    usable: Boolean(
      (process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY_ID) &&
        process.env.RAZORPAY_KEY_SECRET,
    ),
  };

  // The exact strings Figma has to have registered. "Invalid redirect uri" and
  // "Invalid scopes for app" are both refusals on Figma's own page, so the app
  // never sees either and cannot report what it sent — which leaves guessing as
  // the only way to reconcile the two sides. These are that answer.
  const appUrlOrigin = (() => {
    if (!process.env.NEXT_PUBLIC_APP_URL) return null;
    try {
      return new URL(process.env.NEXT_PUBLIC_APP_URL).origin;
    } catch {
      return null;
    }
  })();

  const figma = {
    clientId: describe(process.env.FIGMA_CLIENT_ID),
    clientSecret: describe(process.env.FIGMA_CLIENT_SECRET),
    usable: Boolean(process.env.FIGMA_CLIENT_ID && process.env.FIGMA_CLIENT_SECRET),
    scope: figmaScope(),
    // Reported so it can be compared with the Figma console at a glance. Not a
    // secret — it appears in every authorize URL.
    clientIdValue: process.env.FIGMA_CLIENT_ID?.trim() ?? null,
    note:
      "If connecting fails with \"OAuth app ... doesn't exist\", compare clientIdValue with the app at " +
      "figma.com/developers/apps. Only the authorize page validates it, and that needs a signed-in browser, " +
      "so this endpoint cannot check it for you.",
    redirectUri: appUrlOrigin
      ? figmaRedirectUri(appUrlOrigin)
      : "(derived from the request host — set NEXT_PUBLIC_APP_URL to pin it)",
    hint:
      "Register redirectUri on the Figma app verbatim: scheme, host and path, with no trailing slash. " +
      "Register scope there too. Both are matched exactly.",
  };

  /**
   * GitHub.
   *
   * Reported the same way as Figma, and for the same reason: the one failure
   * that cannot be diagnosed from outside is a callback URL registered with a
   * different path, and the fix needs the exact string. A GitHub OAuth App has
   * one registered callback, so an app already serving Supabase sign-in cannot
   * also serve this — which is why the token path exists and is noted here.
   */
  const github = {
    clientId: describe(process.env.GITHUB_CLIENT_ID),
    clientSecret: describe(process.env.GITHUB_CLIENT_SECRET),
    usable: Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),
    scope: githubScope(),
    // Not a secret: it travels in every authorize URL.
    clientIdValue: process.env.GITHUB_CLIENT_ID?.trim() ?? null,
    redirectUri: appUrlOrigin
      ? githubRedirectUri(appUrlOrigin)
      : "(derived from the request host — set NEXT_PUBLIC_APP_URL to pin it)",
    hint:
      "Register redirectUri as the OAuth app's Authorization callback URL, verbatim. A GitHub OAuth " +
      "app allows only one, so if this app is also used for Supabase sign-in, register a second app " +
      "for the repository connection — or connect with a personal access token, which needs no app.",
  };

  return NextResponse.json(
    {
      configured,
      problem,
      hint,
      github,
      payments: {
        upi,
        razorpay,
        anyUsable: upi.usable || razorpay.usable,
        hint:
          upi.usable || razorpay.usable
            ? null
            : "No payment method is configured. UPI needs UPI_PAYEE_VPA and UPI_PAYEE_NAME; the gateway needs RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET. Neither NEXT_PUBLIC_ nor the rest take effect until a build runs.",
      },
      figma,
      // The assistant and every agent depend on this; without it they can only
      // report that they cannot answer.
      inference: {
        anthropicKey: describe(process.env.ANTHROPIC_API_KEY),
        openaiKey: describe(process.env.OPENAI_API_KEY),
        // Verified, not assumed: `usable` only says the variable is set.
        reachable: inference.reachable,
        problem: inference.problem,
        // Only needed for an organization-scoped key, which the API rejects
        // without it. A workspace-scoped key needs nothing here.
        workspaceId: describe(process.env.ANTHROPIC_WORKSPACE_ID),
        usable: Boolean(process.env.ANTHROPIC_API_KEY),
      },
      // Presence only. No value is ever returned from here.
      variables: {
        NEXT_PUBLIC_SUPABASE_URL: url,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
        NEXT_PUBLIC_APP_URL: appUrl,
        SUPABASE_SERVICE_ROLE_KEY: serviceKey,
      },
      note: "NEXT_PUBLIC_* are inlined at build time; SUPABASE_SERVICE_ROLE_KEY is read at runtime.",
    },
    { headers: { "cache-control": "no-store" } },
  );
}
