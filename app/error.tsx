"use client";

import * as React from "react";
import { RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  React.useEffect(() => {
    // Replace with your reporter (Sentry, etc.) in production.
    console.error(error);
  }, [error]);

  return (
    <main id="main" className="grid min-h-screen place-items-center px-5 text-center">
      <div>
        <h1 className="font-display text-[28px] font-bold tracking-[-0.02em]">Something broke on our side</h1>
        <p className="mx-auto mt-3 max-w-[46ch] text-body text-content-secondary">
          Nothing was lost — your project and its generated files are untouched. Try again, and if it keeps happening
          the error reference is{" "}
          <code className="font-mono text-caption">{error.digest ?? "unknown"}</code>.
        </p>
        <Button variant="primary" className="mt-7" onClick={reset}>
          <RotateCw />
          Try again
        </Button>
      </div>
    </main>
  );
}
