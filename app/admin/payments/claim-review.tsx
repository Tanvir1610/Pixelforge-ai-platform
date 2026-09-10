"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { verifyUpiClaimAction } from "@/lib/actions/billing";

/**
 * Approve or reject one claim.
 *
 * Approving is the moment a plan is granted, so it asks first — a misplaced
 * click here gives away a paid plan, and there is no automatic check behind it
 * to catch the mistake.
 */
export function ClaimReview({ claimId }: { claimId: string }) {
  const router = useRouter();
  const [pending, setPending] = React.useState<"approve" | "reject" | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);

  async function review(approve: boolean) {
    if (approve && !window.confirm("Confirm this payment arrived in the account? This activates the plan.")) {
      return;
    }

    setPending(approve ? "approve" : "reject");
    setMessage(null);

    const note = approve ? undefined : (window.prompt("Reason (shown to the payer):") ?? undefined);
    const result = await verifyUpiClaimAction({ claimId, approve, note });

    setPending(null);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex shrink-0 flex-col items-end gap-1.5">
      <div className="flex gap-2">
        <Button
          variant="outlineDanger"
          size="sm"
          loading={pending === "reject"}
          disabled={pending !== null}
          onClick={() => review(false)}
        >
          <X />
          Reject
        </Button>
        <Button
          variant="dark"
          size="sm"
          loading={pending === "approve"}
          disabled={pending !== null}
          onClick={() => review(true)}
        >
          <Check />
          Confirm received
        </Button>
      </div>
      {message && <p className="text-caption text-error-text">{message}</p>}
    </div>
  );
}
