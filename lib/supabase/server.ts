import "server-only";

import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";
import { getPublicEnv } from "./env";
import { getServiceRoleKey } from "./service-key";

export type Client = SupabaseClient<Database>;

/**
 * Request-scoped client carrying the user's session. Every query it issues runs
 * as `authenticated` with the user's JWT, so RLS applies. This is the client all
 * application code should use.
 */
export async function createClient(): Promise<Client | null> {
  const env = getPublicEnv();
  if (!env) return null;

  const cookieStore = await cookies();

  return createServerClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component, where cookies are read-only. The
          // middleware refreshes the session instead, so this is safe to ignore.
        }
      },
    },
  });
}

/**
 * Service-role client. Bypasses RLS entirely.
 *
 * Use only for trusted background work that has already performed its own
 * authorization: worker pipelines, usage metering, audit writes. Never call it
 * in response to unvalidated user input.
 */
export function createServiceClient(): Client {
  const env = getPublicEnv();
  if (!env) throw new Error("Supabase is not configured.");

  // Imported lazily so the service key never lands in a bundle that also
  // contains client code.
  const { createClient: createSupabaseClient } = require("@supabase/supabase-js") as
    typeof import("@supabase/supabase-js");

  return createSupabaseClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, getServiceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
