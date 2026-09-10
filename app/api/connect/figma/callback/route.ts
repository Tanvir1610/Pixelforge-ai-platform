import { NextResponse, type NextRequest } from "next/server";
import { consumeState } from "@/lib/deploy/oauth";
import { appOrigin, safeRedirect } from "@/lib/deploy/oauth";
import { exchangeFigmaCode, saveFigmaConnection } from "@/lib/figma/oauth";

/**
 * Figma connect callback.
 *
 * A static segment, so it takes precedence over the [provider] route next to it
 * — Figma stores its token in `figma_connections`, not `deployment_credentials`.
 *
 * The state is validated before the code is exchanged. The other way round
 * spends a real authorization code on a request we are about to reject, and
 * tells whoever sent it that their guess was close.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams, origin: requestOrigin } = new URL(request.url);
  const origin = appOrigin(requestOrigin);

  const fail = (reason: string) =>
    NextResponse.redirect(`${origin}/dashboard/import?connect_error=${reason}`);

  if (searchParams.get("error")) return fail("declined");

  const code = searchParams.get("code");
  const state = searchParams.get("state");
  if (!code || !state) return fail("missing_code");

  const context = await consumeState(state);
  // Unknown, expired and replayed states are reported identically: the
  // difference is only useful to someone probing.
  if (!context || context.provider !== "figma") return fail("invalid_state");

  try {
    const token = await exchangeFigmaCode({ code, origin });
    await saveFigmaConnection({
      organizationId: context.organizationId,
      userId: context.userId,
      token,
    });
  } catch (error) {
    console.error("[connect:figma]", error);
    return fail("exchange_failed");
  }

  return NextResponse.redirect(`${origin}${safeRedirect(context.redirectPath, "/dashboard/import")}?connected=figma`);
}
