import type { Metadata } from "next";
import Link from "next/link";
import { AuthLayout, OauthButtons } from "@/components/layout/auth-layout";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = { title: "Create your account" };

export default function SignupPage() {
  return (
    <AuthLayout>
      <div>
        <h1 className="font-display text-[24px] font-bold tracking-[-0.02em] sm:text-[26px]">Create your account</h1>
        <p className="mt-1 text-body text-content-muted">Start with three free projects and 50 AI credits.</p>
      </div>
      <OauthButtons />
      <SignupForm />
      <p className="text-center text-body-sm text-content-muted">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-content underline-offset-4 hover:underline">Sign in</Link>
      </p>
    </AuthLayout>
  );
}
