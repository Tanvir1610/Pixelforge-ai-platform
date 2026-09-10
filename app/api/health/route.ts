import { NextResponse } from "next/server";
import { getPublicEnv, SupabaseConfigError } from "@/lib/supabase/env";

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

export async function GET() {
  // Inlined at build time. A false means the build did not have it.
  const url = describe(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const anonKey = describe(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const appUrl = describe(process.env.NEXT_PUBLIC_APP_URL);

  // Read at runtime, so this one reflects the current settings, not the build.
  const serviceKey = describe(process.env.SUPABASE_SERVICE_ROLE_KEY);

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

  return NextResponse.json(
    {
      configured,
      problem,
      hint,
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
