"use client";

import { useActionState } from "react";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { requestPasswordReset, type ActionState } from "@/lib/auth/actions";

const INITIAL: ActionState = {};

export function ForgotForm() {
  const [state, formAction, pending] = useActionState(requestPasswordReset, INITIAL);

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <Field label="Email" htmlFor="reset-email" error={state.errors?.email}>
        <Input
          id="reset-email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@company.com"
          invalid={Boolean(state.errors?.email)}
          required
        />
      </Field>
      <Button type="submit" variant="primary" size="lg" loading={pending}>Send reset link</Button>
      {state.message && <Banner tone={state.ok ? "success" : "error"}>{state.message}</Banner>}
    </form>
  );
}
