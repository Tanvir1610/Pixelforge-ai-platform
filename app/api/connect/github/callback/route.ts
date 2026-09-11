import { NextResponse, type NextRequest } from "next/server";
import { appOrigin, consumeState, safeRedirect } from "@/lib/deploy/oauth";
import { exchangeGitHubCode, saveGitHubConnection } from "@/lib/github/oauth";

/**
 * GitHub OAuth callback.
 *
 * Its own route rather than a case in `/api/connect/[provider]`, because that
 * handler is for deployment hosts: it writes to `deployment_credentials`, whose
 * `provider` column is the `host_provider` enum. GitHub is a source host with a
 * different table and a different token exchange, and folding it in would mean
 * a Figma or Vercel state could be redeemed as a GitHub credential.
 *
 * The state is validated before the code is exchanged. The other way round
 * spends a real authorization code on a request we are about to reject.
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams, origin: requestOrigin } = new URL(request.url);

  // Not the request's own origin: that is the Host header, which a proxy passes
  // through unchanged, and it is used here both as the OAuth redirect_uri and
  // as the base of the browser redirect below.
  const origin = appOrigin(requestOrigin);

  const fail = (reason: string) =>
    NextResponse.redirect(`${origin}/dashboard/settings?github_error=${reason}`);

  // GitHub sends the user back with `error` when they press Cancel.
  if (searchParams.get("error")) return fail("declined");

  const code = searchParams.get("code");
  const state = searchParams.get("state");
  if (!code || !state) return fail("missing_code");

  const context = await consumeState(state);
  // Unknown, expired and replayed states are reported identically: the
  // difference is only useful to someone probing.
  if (!context || context.provider !== "github") return fail("invalid_state");

  try {
    const token = await exchangeGitHubCode({ code, origin });
    await saveGitHubConnection({
      organizationId: context.organizationId,
      userId: context.userId,
      token,
      tokenKind: "oauth",
    });
  } catch (error) {
    // GitHub's own error slug, which distinguishes the two failures that look
    // identical from the outside and need opposite fixes: a mismatched
    // redirect URI, and an authorization code that has already been spent.
    const reason = error instanceof Error ? error.message : "exchange_failed";
    return fail(encodeURIComponent(reason.slice(0, 60)));
  }

  return NextResponse.redirect(`${origin}${safeRedirect(context.redirectPath, "/dashboard/settings")}?github=connected`);
}
