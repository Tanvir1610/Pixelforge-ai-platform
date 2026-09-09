"use client";

import * as React from "react";
import { useActionState } from "react";
import { Sparkles } from "lucide-react";
import { AiGlyph } from "@/components/ui/ai-glyph";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { analyseDesignAction, type AnalyseState } from "@/lib/actions/analyse";
import type { DesignAnalysis } from "@/lib/ai/schemas";

const INITIAL: AnalyseState = {};

/**
 * Shows the Design Analyst's reading of the file.
 *
 * Corrections are shown as proposals, not applied changes. The user opts in —
 * an agent silently rewriting the IR is exactly the behaviour that makes these
 * systems untrustworthy.
 */
export function AnalysisSummary({
  projectId, analysis, model, disabled, disabledReason,
}: {
  projectId: string | null;
  analysis: (DesignAnalysis & { model?: string }) | null;
  model?: string;
  disabled: boolean;
  disabledReason?: string;
}) {
  const [state, formAction, pending] = useActionState(analyseDesignAction, INITIAL);

  return (
    <section className="mb-4 overflow-hidden rounded-lg border border-border bg-bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-[18px] py-3.5">
        <h2 className="flex items-center gap-2 text-body font-semibold">
          <AiGlyph size="lg" pulse={pending} />
          Design Analyst
        </h2>
        <form action={formAction} className="flex items-center gap-2">
          <input type="hidden" name="projectId" value={projectId ?? ""} />
          <label className="flex items-center gap-2 text-caption text-content-muted">
            <input type="checkbox" name="autoApply" className="h-3.5 w-3.5 accent-[#6366F1]" />
            Apply corrections automatically
          </label>
          <Button type="submit" variant="secondary" size="sm" loading={pending} disabled={disabled}>
            <Sparkles />
            {analysis ? "Re-run analysis" : "Run analysis"}
          </Button>
        </form>
      </div>

      <div className="flex flex-col gap-3 px-[18px] py-4">
        {disabled && disabledReason && <Banner tone="info">{disabledReason}</Banner>}
        {state.message && <Banner tone="error">{state.message}</Banner>}

        {analysis ? (
          <>
            <p className="text-body">{analysis.summary}</p>
            <div className="flex flex-wrap gap-2">
              <Badge tone="accent">{analysis.pageKind}</Badge>
              <Badge>{analysis.sections.length} sections</Badge>
              <Badge tone={analysis.corrections.length ? "warning" : "success"}>
                {analysis.corrections.length} corrections
              </Badge>
              {(model ?? analysis.model) && <Badge className="font-mono">{model ?? analysis.model}</Badge>}
            </div>

            {analysis.corrections.length > 0 && (
              <div>
                <h3 className="mb-2 text-body-sm font-semibold">Proposed corrections</h3>
                <ul className="flex flex-col gap-1.5">
                  {analysis.corrections.map((correction) => (
                    <li
                      key={correction.nodeId}
                      className="flex flex-wrap items-center gap-2 rounded-md border border-border px-2.5 py-2 text-body-sm"
                    >
                      <span className="font-mono text-caption text-content-muted">{correction.nodeId.slice(0, 8)}</span>
                      <span className="font-medium">→ {correction.role}</span>
                      <span className="min-w-0 flex-1 truncate text-content-muted">{correction.reason}</span>
                      <Badge tone="neutral">{Math.round(correction.confidence)}%</Badge>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {analysis.concerns.length > 0 && (
              <div>
                <h3 className="mb-2 text-body-sm font-semibold">Concerns before generating</h3>
                <ul className="flex flex-col gap-1.5">
                  {analysis.concerns.map((concern) => (
                    <li key={concern}>
                      <Banner tone="warning">{concern}</Banner>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        ) : (
          <p className="text-body-sm text-content-muted">
            The heuristic detector has already classified this design. Running the analyst adds a second opinion:
            it names the page&apos;s sections, corrects roles the detector got wrong, and flags anything that would
            make generation unreliable.
          </p>
        )}
      </div>
    </section>
  );
}
