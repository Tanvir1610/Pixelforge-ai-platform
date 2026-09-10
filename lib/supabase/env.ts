import { z } from "zod";

/**
 * Environment access.
 *
 * The app is designed to run without Supabase configured — in that case it
 * falls back to seeded demo data so the UI is still explorable. What it must
 * never do is *half* start: partial configuration is an error, not a fallback.
 */
const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;

/**
 * A configuration fault, distinguishable from every other failure.
 *
 * It used to be a bare `Error`, which meant a server action could not tell "this
 * deployment is misconfigured" from "the user typed something odd" and had to
 * treat both the same way — so a missing variable surfaced as a crashed page
 * with an opaque digest instead of a message naming the variable.
 */
export class SupabaseConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SupabaseConfigError";
  }
}

let cached: PublicEnv | null | undefined;

/**
 * Rejects a URL that parses but is not a Supabase API origin.
 *
 * `z.string().url()` accepts the dashboard address
 * (`https://supabase.com/dashboard/project/<ref>`), which is the easiest thing
 * in the world to paste into the wrong box. Nothing catches it at startup: the
 * pages still render, and the first request that actually calls Supabase dies
 * with `TypeError: fetch failed` somewhere deep in the auth client.
 */
function explainUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return `NEXT_PUBLIC_SUPABASE_URL is not a URL: "${url}".`;
  }

  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
    return `NEXT_PUBLIC_SUPABASE_URL must be https, received "${parsed.protocol}//".`;
  }

  if (parsed.hostname === "supabase.com" || parsed.hostname === "www.supabase.com") {
    return (
      "NEXT_PUBLIC_SUPABASE_URL points at the Supabase dashboard, not your project's API. " +
      "It should look like https://<project-ref>.supabase.co — copy it from Settings → API → Project URL."
    );
  }

  if (parsed.pathname !== "/" && parsed.pathname !== "") {
    return `NEXT_PUBLIC_SUPABASE_URL must be an origin with no path, received "${parsed.pathname}".`;
  }

  return null;
}

export function getPublicEnv(): PublicEnv | null {
  if (cached !== undefined) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

  if (!url && !anonKey) {
    cached = null;
    return cached;
  }

  // Named individually. "Partially configured" was true but unhelpful — it did
  // not say which half was missing, which is the only thing the reader needs.
  const missing: string[] = [];
  if (!url) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!anonKey) missing.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  if (missing.length > 0) {
    throw new SupabaseConfigError(
      `Supabase is half-configured: ${missing.join(" and ")} ${missing.length === 1 ? "is" : "are"} not set. ` +
        "Set both, or neither to run on demo data.",
    );
  }

  const urlProblem = explainUrl(url as string);
  if (urlProblem) throw new SupabaseConfigError(urlProblem);

  const parsed = publicEnvSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: url,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
  });

  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new SupabaseConfigError(`Supabase configuration is invalid — ${detail}`);
  }

  cached = parsed.data;
  return cached;
}

/** Test seam. Configuration is read once per process and cached. */
export function resetPublicEnvCache(): void {
  cached = undefined;
}

export function isSupabaseConfigured(): boolean {
  return getPublicEnv() !== null;
}

// The service-role key deliberately does NOT live here. This module is imported
// by lib/supabase/client.ts, which is a "use client" file, so everything in it
// is reachable from the browser bundle. See ./service-key.ts, which is
// server-only and cannot be pulled in by accident.
