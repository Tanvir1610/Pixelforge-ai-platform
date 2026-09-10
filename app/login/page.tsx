import type { Metadata } from "next";
import Link from "next/link";
import { AuthLayout, OauthButtons } from "@/components/layout/auth-layout";
import { Banner } from "@/components/ui/banner";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

/**
 * Reasons the OAuth flow can bounce back here.
 *
 * A failed provider sign-in used to redirect to `/login?error=…` and the page
 * ignored the parameter entirely, so the user was returned to an unchanged form
 * with no indication that anything had happened.
 */
const OAUTH_ERRORS: Record<string, string> = {
  provider_disabled:
    "That sign-in provider isn't enabled for this project yet. Use your email and password, or enable it in Supabase under Authentication → Providers.",
  oauth_failed: "That sign-in didn't complete. Try again, or use your email and password.",
  not_configured: "Social sign-in isn't available on this deployment yet. Use your email and password.",
  missing_code: "That sign-in link is incomplete. Start again from this page.",
  exchange_failed: "That sign-in link has expired or was already used. Try again.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; provider?: string }>;
}) {
  const { error } = await searchParams;
  const notice = error ? (OAUTH_ERRORS[error] ?? OAUTH_ERRORS.oauth_failed) : null;

  return (
    <AuthLayout>
      <div>
        <h1 className="font-display text-[24px] font-bold tracking-[-0.02em] sm:text-[26px]">Welcome back</h1>
        <p className="mt-1 text-body text-content-muted">
          Sign in to pick up where your last generation left off.
        </p>
      </div>
      {notice && <Banner tone="error">{notice}</Banner>}
      <OauthButtons />
      <LoginForm />
      <p className="text-center text-body-sm text-content-muted">
        New here?{" "}
        <Link href="/signup" className="font-medium text-content underline-offset-4 hover:underline">
          Create an account
        </Link>
      </p>
    </AuthLayout>
  );
}
