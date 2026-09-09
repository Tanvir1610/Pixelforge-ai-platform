import type { Metadata } from "next";
import Link from "next/link";
import { AuthLayout, OauthButtons } from "@/components/layout/auth-layout";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <AuthLayout>
      <div>
        <h1 className="font-display text-[26px] font-bold tracking-[-0.02em]">Welcome back</h1>
        <p className="mt-1 text-body text-content-muted">
          Sign in to pick up where your last generation left off.
        </p>
      </div>
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
