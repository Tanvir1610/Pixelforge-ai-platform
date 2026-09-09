import type { Metadata } from "next";
import Link from "next/link";
import { AuthLayout } from "@/components/layout/auth-layout";
import { ForgotForm } from "./forgot-form";

export const metadata: Metadata = { title: "Reset your password" };

export default function ForgotPasswordPage() {
  return (
    <AuthLayout>
      <div>
        <h1 className="font-display text-[26px] font-bold tracking-[-0.02em]">Reset your password</h1>
        <p className="mt-1 text-body text-content-muted">
          We&apos;ll email a link that signs you in and lets you set a new password.
        </p>
      </div>
      <ForgotForm />
      <p className="text-center text-body-sm text-content-muted">
        <Link href="/login" className="font-medium text-content underline-offset-4 hover:underline">
          Back to sign in
        </Link>
      </p>
    </AuthLayout>
  );
}
