"use client";

import * as React from "react";
import Link from "next/link";
import { useActionState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { signIn, type ActionState } from "@/lib/auth/actions";

const INITIAL: ActionState = {};

export function LoginForm() {
  const [state, formAction, pending] = useActionState(signIn, INITIAL);
  const [showPassword, setShowPassword] = React.useState(false);

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {state.message && <Banner tone="error">{state.message}</Banner>}

      <Field label="Email" htmlFor="email" error={state.errors?.email}>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@company.com"
          invalid={Boolean(state.errors?.email)}
          required
        />
      </Field>

      <Field
        label="Password"
        htmlFor="password"
        error={state.errors?.password}
        action={
          <Link href="/forgot-password" className="text-body-sm text-accent underline-offset-4 hover:underline">
            Forgot password?
          </Link>
        }
      >
        <Input
          id="password"
          name="password"
          type={showPassword ? "text" : "password"}
          autoComplete="current-password"
          placeholder="••••••••••"
          invalid={Boolean(state.errors?.password)}
          required
          trailing={
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              className="grid place-items-center"
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          }
        />
      </Field>

      <Button type="submit" variant="primary" size="lg" loading={pending}>Sign in</Button>
    </form>
  );
}
