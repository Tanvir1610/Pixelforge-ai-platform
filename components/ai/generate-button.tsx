"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { generateStepAction, planProjectAction, startCodegenAction } from "@/lib/actions/generate";

/**
 * Runs planning, then code generation one step at a time.
 *
 * The loop lives here rather than on the server because each step is its own
 * request: a serverless invocation cannot hold a generation open for the
 * minutes the model calls take. So the client asks for step 0, and asks for
 * step 1 when that returns.
 *
 * The consequence worth knowing is that closing the tab stops it. Everything
 * generated so far is already committed as a code version, so nothing is lost
 * and pressing the button again continues from a fresh run — but it is not a
 * background job, and a worker is what would make it one.
 */
type Phase =
  | { name: "idle" }
  | { name: "planning" }
  | { name: "generating"; index: number; total: number; label: string; runId: string }
  | { name: "done"; versionNumber?: number }
  | { name: "error"; message: string };

export function GenerateButton({ canGenerate }: { canGenerate: boolean }) {
  const router = useRouter();
  const [phase, setPhase] = React.useState<Phase>({ name: "idle" });
  // Set when the tab goes away mid-run, so the loop stops asking for more.
  const cancelled = React.useRef(false);

  React.useEffect(() => {
    return () => {
      cancelled.current = true;
    };
  }, []);

  async function run() {
    cancelled.current = false;
    setPhase({ name: "planning" });

    const planned = await planProjectAction();
    if (!planned.ok) {
      setPhase({ name: "error", message: planned.message });
      return;
    }

    const started = await startCodegenAction();
    if (!started.ok || !started.runId || !started.total) {
      setPhase({ name: "error", message: started.message });
      return;
    }

    for (let index = 0; index < started.total; index += 1) {
      if (cancelled.current) return;

      setPhase({
        name: "generating",
        index,
        total: started.total,
        label: started.steps?.[index] ?? `Step ${index + 1}`,
        runId: started.runId,
      });

      const outcome = await generateStepAction({ runId: started.runId, index });

      if (!outcome.ok) {
        setPhase({ name: "error", message: outcome.errorMessage ?? "Generation failed." });
        return;
      }

      if (outcome.done) {
        setPhase({ name: "done", versionNumber: outcome.versionNumber });
        router.refresh();
        return;
      }
    }
  }

  if (phase.name === "done") {
    return (
      <Banner tone="success">
        Code generated{phase.versionNumber ? ` as version ${phase.versionNumber}` : ""}. It has not been
        compiled — this deployment has no build sandbox, so treat it as a draft.
      </Banner>
    );
  }

  const busy = phase.name === "planning" || phase.name === "generating";

  return (
    <div className="flex flex-col gap-3">
      <Button
        variant="primary"
        size="lg"
        loading={busy}
        disabled={!canGenerate || busy}
        onClick={run}
        className="w-full"
      >
        <Sparkles />
        {busy ? "Generating…" : "Generate code"}
      </Button>

      {phase.name === "planning" && (
        <p className="text-body-sm text-content-muted">
          Reading the design, then planning the architecture and components…
        </p>
      )}

      {phase.name === "generating" && (
        <div>
          <Progress
            value={Math.round((phase.index / phase.total) * 100)}
            label="Code generation progress"
          />
          <p className="mt-1.5 text-body-sm text-content-muted">
            Step {phase.index + 1} of {phase.total} · {phase.label}
          </p>
          <p className="mt-1 text-caption text-content-muted">
            Keep this tab open — each step is a separate request.
          </p>
        </div>
      )}

      {phase.name === "error" && <Banner tone="error">{phase.message}</Banner>}

      {!canGenerate && phase.name === "idle" && (
        <p className="text-body-sm text-content-muted">
          Import a design first — generation reads the layers that produced.
        </p>
      )}
    </div>
  );
}
