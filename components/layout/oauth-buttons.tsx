"use client";

import * as React from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";

/**
 * One provider button.
 *
 * Split out as a client component only so `useFormStatus` has a form to read.
 * The form itself posts to a server action, so the button works before
 * hydration and with JavaScript disabled — which is the right default for the
 * control standing between a visitor and an account.
 */
export function ProviderButton({
  provider,
  label,
  children,
}: {
  provider: "google" | "github";
  label: string;
  children: React.ReactNode;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      name="provider"
      value={provider}
      disabled={pending}
      aria-label={`Continue with ${label}`}
      className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md border border-border bg-bg-surface text-body font-medium shadow-sm transition-colors hover:bg-bg-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60 sm:h-9"
    >
      {pending ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : children}
      <span className="truncate">{label}</span>
    </button>
  );
}
