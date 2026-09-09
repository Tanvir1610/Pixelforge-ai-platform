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

let cached: PublicEnv | null | undefined;

export function getPublicEnv(): PublicEnv | null {
  if (cached !== undefined) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url && !anonKey) {
    cached = null;
    return cached;
  }

  const parsed = publicEnvSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: url,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
  });

  if (!parsed.success) {
    throw new Error(
      "Supabase is partially configured. Set both NEXT_PUBLIC_SUPABASE_URL and " +
        "NEXT_PUBLIC_SUPABASE_ANON_KEY, or neither to run in demo mode.",
    );
  }

  cached = parsed.data;
  return cached;
}

export function isSupabaseConfigured(): boolean {
  return getPublicEnv() !== null;
}

/**
 * Service-role key. Bypasses RLS, so it may only ever be read on the server and
 * must never be imported into a client component or an Edge middleware bundle.
 */
export function getServiceRoleKey(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for this operation.");
  return key;
}
