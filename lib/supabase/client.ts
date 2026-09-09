"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";
import { getPublicEnv } from "./env";

let client: SupabaseClient<Database> | null = null;

/** Browser client. Singleton so auth state is shared across components. */
export function createClient(): SupabaseClient<Database> | null {
  const env = getPublicEnv();
  if (!env) return null;
  if (client) return client;

  client = createBrowserClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  return client;
}
