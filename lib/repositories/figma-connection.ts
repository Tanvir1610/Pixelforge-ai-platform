import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { Session } from "@/lib/auth/session";

/**
 * Whether the caller has a live Figma connection.
 *
 * Goes through the `my_figma_connection` function rather than the table: the
 * table has no client policy at all, so a token can never be read from a
 * browser session. The function returns only non-secret columns.
 */
export async function hasFigmaConnection(session: Session): Promise<boolean> {
  if (session.demo) return false;

  const supabase = await createClient();
  if (!supabase) return false;

  const { data, error } = await supabase.rpc("my_figma_connection");
  if (error || !data) return false;

  return data.some((row) => row.is_active);
}
