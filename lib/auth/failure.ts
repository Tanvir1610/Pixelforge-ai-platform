import { SupabaseConfigError } from "@/lib/supabase/env";

/**
 * Turns an unexpected throw into something a form can display.
 *
 * A server action that throws takes the whole route down to `app/error.tsx` —
 * the user sees "Something broke on our side" and a digest, and the real cause
 * is visible only in the platform logs. For a sign-up form that is the wrong
 * trade twice over: the page was fine, and the person who most needs to know
 * what went wrong is the one deploying it.
 *
 * So every auth action catches, logs the real error with a greppable prefix,
 * and returns a message. Two failures are named specifically because they are
 * the two that actually happen on a fresh deployment, and both look identical
 * from the outside:
 *
 * - the environment variables are missing or wrong, and
 * - they are present but the URL does not resolve, so `fetch` throws.
 */
export interface AuthFailure {
  message: string;
  /** True when the deployment is at fault rather than the user's input. */
  configuration: boolean;
}

/** A failed `fetch` inside the Supabase client, whatever the runtime called it. */
function isNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const text = `${error.name} ${error.message} ${(error.cause as Error | undefined)?.message ?? ""}`;
  return /fetch failed|network|ENOTFOUND|ECONNREFUSED|EAI_AGAIN|ETIMEDOUT|AbortError|und_err/i.test(text);
}

export function describeAuthFailure(scope: string, error: unknown): AuthFailure {
  // One prefix for all of them, so the platform log filter is a single string.
  console.error(`[auth:${scope}]`, error);

  if (error instanceof SupabaseConfigError) {
    // The message names the offending variable and never contains its value —
    // that is the whole point of the distinct error type. Showing it beats
    // listing both variables and leaving the reader to guess which is wrong.
    return {
      message: `This deployment isn't connected to Supabase correctly, so accounts can't be created yet. ${error.message}`,
      configuration: true,
    };
  }

  if (isNetworkError(error)) {
    return {
      message:
        "We couldn't reach the authentication service. If this deployment was just set up, check that " +
        "NEXT_PUBLIC_SUPABASE_URL is the project's API URL (https://<project-ref>.supabase.co).",
      configuration: true,
    };
  }

  return { message: "Something went wrong on our side. Try again in a moment.", configuration: false };
}
