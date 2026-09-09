import { NextResponse, type NextRequest } from "next/server";
import { consumeState, exchangeCode, safeRedirect, saveCredential } from "@/lib/deploy/oauth";
import type { ProviderKey } from "@/lib/deploy/types";

const PROVIDERS = new Set<ProviderKey>(["vercel", "netlify", "cloudflare"]);

/**
 * Host OAuth callback.
 *
 * The state is validated before the code is exchanged. Doing it the other way
 * round would spend a real authorization code on a request we are about to
 * reject, and hand the attacker a signal that their guess was close.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ provider: string }> },
) {
  const { provider } = await context.params;
  const { searchParams, origin } = new URL(request.url);

  const fail = (reason: string) =>
    NextResponse.redirect(`${origin}/dashboard/deployments?connect_error=${reason}`);

  if (!PROVIDERS.has(provider as ProviderKey)) return fail("unknown_provider");
  if (searchParams.get("error")) return fail("declined");

  const code = searchParams.get("code");
  const state = searchParams.get("state");
  if (!code || !state) return fail("missing_code");

  const connectContext = await consumeState(state);
  // Unknown, expired and replayed states are all reported identically: the
  // difference is only useful to someone probing.
  if (!connectContext || connectContext.provider !== provider) return fail("invalid_state");

  try {
    const token = await exchangeCode({ provider: connectContext.provider, code, origin });
    await saveCredential({
      organizationId: connectContext.organizationId,
      provider: connectContext.provider,
      userId: connectContext.userId,
      token,
    });
  } catch {
    return fail("exchange_failed");
  }

  return NextResponse.redirect(`${origin}${safeRedirect(connectContext.redirectPath)}?connected=${provider}`);
}
