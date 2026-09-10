import "server-only";

/**
 * The service-role key.
 *
 * Bypasses RLS entirely, so it lives alone in a module marked `server-only`.
 * It used to sit in `./env.ts` beside the public config — and `./env.ts` is
 * imported by `./client.ts`, which is a `"use client"` module, so the accessor
 * was reachable from the browser bundle.
 *
 * Nothing leaked: Next.js replaces a non-`NEXT_PUBLIC_` `process.env` read with
 * `undefined` on the client, so the function would have thrown rather than
 * returned a key. But that is a bundler behaviour standing in for a boundary,
 * and the comment above the function claimed a boundary that was not there.
 * `server-only` makes it a build error instead of a near miss.
 */
export function getServiceRoleKey(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for this operation.");
  return key;
}
