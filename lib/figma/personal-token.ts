import "server-only";

import { createServiceClient } from "@/lib/supabase/server";

/**
 * Connecting with a personal access token.
 *
 * The OAuth flow only works for accounts inside the organization that owns the
 * Figma app, unless that app is published publicly and approved by Figma. A
 * personal access token has no such gate: the user creates one in their own
 * Figma settings, and it authorises exactly the files that account can already
 * open — the same boundary OAuth would have drawn.
 *
 * It is stored in `figma_connections` beside an OAuth token, and the row records
 * which kind it is: the two use different headers, so a pasted token sent as a
 * bearer would come back unauthorised with nothing to say why.
 */
const ME_URL = "https://api.figma.com/v1/me";

/** Figma issues these with a `figd_` prefix. Checked before spending a call. */
const TOKEN_SHAPE = /^figd_[A-Za-z0-9_-]{20,}$/;

export interface FigmaAccount {
  id: string;
  handle: string;
}

export class FigmaTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FigmaTokenError";
  }
}

/**
 * Verifies the token against Figma before storing it.
 *
 * Storing an unverified token would move the failure to the first import, where
 * it reads as a broken product rather than a mistyped paste.
 */
export async function verifyPersonalToken(
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<FigmaAccount> {
  const trimmed = token.trim();

  if (!trimmed) throw new FigmaTokenError("Paste your Figma personal access token.");
  if (!TOKEN_SHAPE.test(trimmed)) {
    throw new FigmaTokenError(
      "That doesn't look like a Figma personal access token — they begin with \"figd_\". " +
        "Create one under Figma → Settings → Security → Personal access tokens.",
    );
  }

  let response: Response;
  try {
    response = await fetchImpl(ME_URL, {
      // A personal token goes in X-Figma-Token, never as a bearer.
      headers: { "X-Figma-Token": trimmed },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new FigmaTokenError("We couldn't reach Figma to check that token. Try again in a moment.");
  }

  if (response.status === 401 || response.status === 403) {
    throw new FigmaTokenError(
      "Figma rejected that token. Check it was copied in full, and that it has not expired or been revoked.",
    );
  }
  if (!response.ok) {
    throw new FigmaTokenError(`Figma returned an unexpected response (${response.status}). Try again.`);
  }

  const profile = (await response.json()) as { id?: string; handle?: string; email?: string };
  if (!profile.id) throw new FigmaTokenError("Figma did not identify the account for that token.");

  return { id: profile.id, handle: profile.handle ?? profile.email ?? "Figma account" };
}

/** Stores the token. Service role only — this table has no client policy. */
export async function savePersonalToken(params: {
  organizationId: string;
  userId: string;
  token: string;
  account: FigmaAccount;
}): Promise<void> {
  const supabase = createServiceClient();

  const { error } = await supabase.from("figma_connections").upsert(
    {
      organization_id: params.organizationId,
      user_id: params.userId,
      figma_user_id: params.account.id,
      figma_handle: params.account.handle,
      access_token: params.token.trim(),
      token_kind: "personal",
      // A personal token carries no refresh and no expiry; recording a fake one
      // would make the connection look dead on a schedule of our invention.
      refresh_token: null,
      expires_at: null,
      revoked_at: null,
    },
    { onConflict: "organization_id,user_id" },
  );

  if (error) throw new FigmaTokenError(`Could not save the connection: ${error.message}`);
}
