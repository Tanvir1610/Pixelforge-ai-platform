"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { describeAuthFailure } from "./failure";
import { fieldErrors, resetPasswordSchema, signInSchema, signUpSchema } from "@/lib/validation/schemas";

export interface ActionState {
  errors?: Record<string, string>;
  message?: string;
  ok?: boolean;
}

const DEMO_NOTICE =
  "Supabase isn't configured, so the app is running on demo data. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to enable real accounts.";

/**
 * Auth server actions.
 *
 * Supabase error text is deliberately not surfaced verbatim: "user not found"
 * versus "wrong password" is a user-enumeration oracle. Both map to one message.
 *
 * Every action here is written so that nothing it does can throw past its own
 * return. `redirect()` is the exception and is always called *outside* the try,
 * because it works by throwing and must be allowed to propagate.
 */

/**
 * Resolves the origin for links sent by email.
 *
 * `NEXT_PUBLIC_APP_URL` first: behind a proxy the `origin` header is whatever
 * the proxy was handed, and a confirmation link is not something to build out of
 * a header a caller controls.
 */
async function linkOrigin(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      // Fall through to the request's own origin.
    }
  }
  return (await headers()).get("origin") ?? "";
}

export async function signIn(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  try {
    if (!isSupabaseConfigured()) return { message: DEMO_NOTICE };

    const supabase = await createClient();
    if (!supabase) return { message: DEMO_NOTICE };

    const { error } = await supabase.auth.signInWithPassword(parsed.data);
    if (error) return { message: "That email and password combination doesn't match an account." };
  } catch (error) {
    return { message: describeAuthFailure("sign-in", error).message };
  }

  revalidatePath("/", "layout");
  redirect("/dashboard");
}

export async function signUp(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = signUpSchema.safeParse({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  try {
    if (!isSupabaseConfigured()) return { message: DEMO_NOTICE };

    const supabase = await createClient();
    if (!supabase) return { message: DEMO_NOTICE };

    const origin = await linkOrigin();
    const { error } = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: {
        data: { full_name: parsed.data.fullName },
        emailRedirectTo: `${origin}/auth/callback`,
      },
    });

    if (error) {
      if (error.message.toLowerCase().includes("already")) {
        return { message: "An account with that email already exists. Try signing in instead." };
      }

      // The sign-up trigger creates the profile, organization and owner
      // membership. When it fails Supabase reports a database error, and the
      // account is left unusable — worth its own message, because "try again"
      // will never work and the fix is to apply the migrations.
      if (/database error/i.test(error.message)) {
        console.error("[auth:sign-up] database error saving new user", error.message);
        return {
          message:
            "Your account could not be set up. The database is reachable but its sign-up trigger failed — " +
            "usually the migrations have not been applied to this project.",
        };
      }

      console.error("[auth:sign-up] supabase rejected the sign-up:", error.message);
      return { message: "We couldn't create the account. Try again in a moment." };
    }
  } catch (error) {
    return { message: describeAuthFailure("sign-up", error).message };
  }

  return { ok: true, message: "Check your inbox to confirm your email address." };
}

export async function requestPasswordReset(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = resetPasswordSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  try {
    if (!isSupabaseConfigured()) return { message: DEMO_NOTICE };

    const supabase = await createClient();
    if (!supabase) return { message: DEMO_NOTICE };

    const origin = await linkOrigin();
    await supabase.auth.resetPasswordForEmail(parsed.data.email, {
      redirectTo: `${origin}/auth/callback?next=/dashboard`,
    });
  } catch (error) {
    return { message: describeAuthFailure("reset", error).message };
  }

  // Always reports success: whether an account exists must not be observable.
  return { ok: true, message: "If that address has an account, a reset link is on its way." };
}

export type OauthProvider = "google" | "github";

/**
 * Starts a hosted OAuth flow.
 *
 * Returns the provider's authorize URL rather than redirecting, so the caller
 * decides what to do when it fails. `redirect()` throws by design, and calling
 * it inside the try below would be caught by the catch meant for real errors.
 */
async function authorizeUrl(provider: OauthProvider): Promise<{ url: string } | { error: string }> {
  try {
    if (!isSupabaseConfigured()) return { error: "not_configured" };

    const supabase = await createClient();
    if (!supabase) return { error: "not_configured" };

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${await linkOrigin()}/auth/callback`,
        // Supabase returns the URL instead of navigating, which is what a
        // server action needs — there is no browser here to redirect.
        skipBrowserRedirect: true,
      },
    });

    if (error) {
      // The commonest cause by far: the provider is simply not enabled in the
      // Supabase dashboard. Named separately so the login page can say so.
      console.error(`[auth:oauth:${provider}]`, error.message);
      return { error: /provider is not enabled|unsupported provider/i.test(error.message) ? "provider_disabled" : "oauth_failed" };
    }

    if (!data?.url) return { error: "oauth_failed" };
    return { url: data.url };
  } catch (error) {
    describeAuthFailure(`oauth:${provider}`, error);
    return { error: "oauth_failed" };
  }
}

/**
 * Form action for the provider buttons.
 *
 * A plain `<form action={…}>` rather than an onClick: it works before hydration
 * and without client JavaScript, which is the right default for the one control
 * standing between a visitor and an account.
 */
export async function signInWithProvider(formData: FormData): Promise<void> {
  const requested = formData.get("provider");
  const provider: OauthProvider = requested === "github" ? "github" : "google";

  const result = await authorizeUrl(provider);

  // Outside every try block above, so the redirect is free to throw.
  if ("error" in result) redirect(`/login?error=${result.error}&provider=${provider}`);
  redirect(result.url);
}
