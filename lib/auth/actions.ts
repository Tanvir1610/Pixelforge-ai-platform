"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
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
 */
export async function signIn(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  if (!isSupabaseConfigured()) return { message: DEMO_NOTICE };

  const supabase = await createClient();
  if (!supabase) return { message: DEMO_NOTICE };

  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { message: "That email and password combination doesn't match an account." };

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

  if (!isSupabaseConfigured()) return { message: DEMO_NOTICE };

  const supabase = await createClient();
  if (!supabase) return { message: DEMO_NOTICE };

  const origin = (await headers()).get("origin") ?? "";
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
    return { message: "We couldn't create the account. Try again in a moment." };
  }

  return { ok: true, message: "Check your inbox to confirm your email address." };
}

export async function requestPasswordReset(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = resetPasswordSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  if (!isSupabaseConfigured()) return { message: DEMO_NOTICE };

  const supabase = await createClient();
  if (!supabase) return { message: DEMO_NOTICE };

  const origin = (await headers()).get("origin") ?? "";
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${origin}/auth/callback?next=/dashboard`,
  });

  // Always reports success: whether an account exists must not be observable.
  return { ok: true, message: "If that address has an account, a reset link is on its way." };
}

export async function signInWithProvider(provider: "google" | "github") {
  const supabase = await createClient();
  if (!supabase) redirect("/login?error=not_configured");

  const origin = (await headers()).get("origin") ?? "";
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: `${origin}/auth/callback` },
  });

  if (error || !data.url) redirect("/login?error=oauth_failed");
  redirect(data.url);
}
