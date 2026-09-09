"use client";

import * as React from "react";
import { useActionState } from "react";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { signUp, type ActionState } from "@/lib/auth/actions";

const INITIAL: ActionState = {};

export function SignupForm() {
  const [state, formAction, pending] = useActionState(signUp, INITIAL);
  const [accepted, setAccepted] = React.useState(true);

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {state.message && <Banner tone={state.ok ? "success" : "error"}>{state.message}</Banner>}

      <Field label="Full name" htmlFor="name" error={state.errors?.fullName}>
        <Input
          id="name"
          name="fullName"
          autoComplete="name"
          placeholder="Tanvir Ahmad"
          invalid={Boolean(state.errors?.fullName)}
          required
        />
      </Field>

      <Field label="Work email" htmlFor="work-email" error={state.errors?.email}>
        <Input
          id="work-email"
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
        htmlFor="new-password"
        help="Use 10 or more characters with a number or symbol."
        error={state.errors?.password}
      >
        <Input
          id="new-password"
          name="password"
          type="password"
          autoComplete="new-password"
          placeholder="At least 10 characters"
          minLength={10}
          invalid={Boolean(state.errors?.password)}
          required
        />
      </Field>

      <div className="flex items-start gap-2.5">
        <input
          id="terms"
          type="checkbox"
          checked={accepted}
          onChange={(event) => setAccepted(event.target.checked)}
          className="mt-0.5 h-4 w-4 rounded-[4px] border-border-strong accent-[#6366F1]"
        />
        <label htmlFor="terms" className="text-body-sm text-content-secondary">
          I agree to the terms of service and privacy policy.
        </label>
      </div>

      <Button type="submit" variant="primary" size="lg" disabled={!accepted} loading={pending}>
        Create account
      </Button>
    </form>
  );
}
