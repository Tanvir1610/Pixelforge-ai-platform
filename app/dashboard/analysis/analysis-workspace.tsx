"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { AiGlyph } from "@/components/ui/ai-glyph";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { buttonClasses } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { StatusDot } from "@/components/ui/status";
import { FigmaCanvas } from "@/components/preview/figma-canvas";
import { MiniSite, ScaledSite } from "@/components/preview/mini-site";
import { DesignPreview } from "@/components/preview/design-preview";
import type { FramePreview } from "@/lib/repositories/design-read";
import { useGenerationRun } from "@/hooks/use-generation-run";
import { useSequence } from "@/hooks/use-sequence";
import { ANALYSIS_STEPS } from "@/lib/data";
import { cn } from "@/lib/utils";
import type { GenerationRunRow, GenerationStepRow, RunStatus } from "@/lib/db/database.types";

/**
 * Region overlays for the scripted demo only.
 *
 * A real run labels what was actually detected, from the frame's own top-level
 * nodes. These stood in for that on every run, real or not, so a live import of
 * a component library was captioned "Navbar / Hero / Feature card x3".
 */
const SAMPLE_REGIONS = [
  { name: "Navbar", top: "52px", height: "44px" },
  { name: "Hero", top: "120px", height: "210px" },
  { name: "Feature card ×3", top: "360px", height: "120px" },
];

/** Percentages, so an overlay tracks the preview at whatever scale it drew at. */
function regionsFor(frame: FramePreview) {
  return frame.regions.map((region) => ({
    name: region.role ? `${region.name} · ${region.role}` : region.name,
    top: `${(region.y / frame.height) * 100}%`,
    height: `${Math.max(1.5, (region.height / frame.height) * 100)}%`,
    left: `${(region.x / frame.width) * 100}%`,
    right: `${Math.max(0, 100 - ((region.x + region.width) / frame.width) * 100)}%`,
  }));
}

interface DisplayStep {
  id: string;
  label: string;
  state: RunStatus | "pending" | "active" | "done";
  result?: string;
}

/** Maps a database run status onto the StatusDot vocabulary. */
function toDotState(status: RunStatus): "pending" | "active" | "done" | "failed" {
  if (status === "completed") return "done";
  if (status === "running") return "active";
  if (status === "failed" || status === "cancelled") return "failed";
  return "pending";
}

export function AnalysisWorkspace({
  projectName, runId, initial, demo, frame,
}: {
  projectName: string;
  runId: string | null;
  initial?: { run: GenerationRunRow; steps: GenerationStepRow[] };
  demo: boolean;
  /** The imported frame. Absent before an import has produced one. */
  frame?: FramePreview | null;
}) {
  const live = useGenerationRun(runId, initial);
  // Demo mode has no run to watch, so the scripted sequence stands in.
  const scripted = useSequence(ANALYSIS_STEPS, 1500, demo);

  const usingLive = Boolean(runId) && !demo;

  /**
   * A real account that has never run anything.
   *
   * This used to fall through to the scripted list, which is not merely
   * animated — its entries carry fixed results: "14 sections", "9 found",
   * "6 styles", "11 tokens", "23 files", with five of eight already marked
   * done. So a workspace that had analysed nothing was shown a half-finished
   * analysis of a design it did not have, and the numbers looked like findings.
   */
  const nothingYet = !usingLive && !demo;

  const steps: DisplayStep[] = usingLive
    ? live.steps.map((step) => ({
        id: step.id,
        label: step.label,
        state: toDotState(step.status),
        result: step.result_summary ?? undefined,
      }))
    : nothingYet
      ? ANALYSIS_STEPS.map((item) => ({
          // The same step names — they are what the pipeline really does — but
          // every one pending and none carrying a result.
          id: item.id,
          label: item.label,
          state: "pending" as const,
        }))
      : scripted.items.map((item) => ({
          id: item.id,
          label: item.label,
          state: item.state,
          result: item.result,
        }));

  const percent = usingLive ? live.percent : nothingYet ? 0 : scripted.percent;
  const complete = usingLive ? live.complete : nothingYet ? false : scripted.complete;
  const failed = usingLive && live.failed;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border bg-bg px-5 md:px-6">
        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2 text-body-sm text-content-muted">
          <Link href="/dashboard" className="truncate hover:text-content">{projectName}</Link>
          <ChevronRight aria-hidden className="h-3.5 w-3.5 shrink-0" />
          <span className="font-medium text-content">Analysis</span>
        </nav>
        <div className="flex items-center gap-3">
          {/* Was a fixed "Step 2 of 3" whatever the run was doing. */}
          <Badge
            tone={failed ? "error" : complete ? "success" : nothingYet ? "neutral" : "accent"}
            dot={!failed && !nothingYet}
          >
            {failed
              ? "Failed"
              : complete
                ? "Analysis complete"
                : nothingYet
                  ? "Not started"
                  : `${Math.round(percent)}%`}
          </Badge>
          {usingLive && !live.connected && !complete && (
            <Badge tone="neutral" className="hidden sm:inline-flex">Reconnecting</Badge>
          )}
          <Link href="/dashboard" className={buttonClasses("ghost", "sm")}>Cancel</Link>
        </div>
      </header>

      <main id="main" className="grid flex-1 lg:grid-cols-[1fr_440px]">
        {/* The real frame when there is one. The fabricated page is now only
            what the scripted demo shows, and it says so underneath. */}
        <FigmaCanvas
          className="relative min-h-[320px] p-6 md:p-10"
          regions={frame ? regionsFor(frame) : SAMPLE_REGIONS}
          scanning={!complete && !failed}
        >
          {frame ? (
            <div className="flex flex-col items-center gap-2">
              <DesignPreview frame={frame} />
              <p className="text-caption text-content-muted">
                {frame.name} · {frame.width}×{frame.height}
                {frame.frameCount > 1 && ` · ${frame.frameCount} frames imported`}
                {" · "}
                {frame.nodes.length} layers drawn
              </p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <ScaledSite scale={1.6} height={420} className="border border-[#DADADA] shadow-lg">
                <MiniSite brand={projectName.split(" ")[0]} headline="Ship your ideas without the rebuild." />
              </ScaledSite>
              <p className="text-caption text-content-muted">Sample frame — import a design to see your own.</p>
            </div>
          )}
        </FigmaCanvas>

        <aside className="flex flex-col border-t border-border bg-bg-surface lg:border-l lg:border-t-0">
          <div className="border-b border-border p-6">
            <h1 className="flex items-center gap-2.5 text-h3">
              <AiGlyph size="lg" pulse={!complete && !failed && !nothingYet} />
              {failed
                ? "Analysis failed"
                : complete
                  ? "Analysis complete"
                  : nothingYet
                    ? "No analysis yet"
                    : "Analysing your design…"}
            </h1>
            <p className="mt-1 text-body-sm text-content-muted">
              {projectName}
              {usingLive ? "" : " · sample run"}
            </p>
            <Progress value={percent} className="mt-3.5" label="Analysis progress" />
          </div>

          <ol className="flex flex-col p-4 md:px-6">
            {steps.map((step) => (
              <li
                key={step.id}
                className={cn("flex items-center gap-3 py-2.5 text-body", step.state === "pending" && "text-content-muted")}
              >
                <StatusDot state={step.state as "pending" | "active" | "done" | "failed"} />
                <span className={cn("min-w-0 flex-1", step.state !== "pending" && "font-medium")}>{step.label}</span>
                {step.result && <span className="font-mono text-caption text-content-muted">{step.result}</span>}
                {step.state === "active" && <span className="font-mono text-caption text-content-muted">…</span>}
              </li>
            ))}
          </ol>

          <div className="px-6">
            {failed ? (
              <Banner tone="error">
                {live.run?.error_message ?? "The import stopped before it finished."}
              </Banner>
            ) : nothingYet ? (
              <Banner tone="info">
                Nothing has been analysed in this workspace yet. Import a design and run the analyst —
                the steps above are what it will do, in order.
              </Banner>
            ) : demo ? (
              <Banner tone="info">
                <b className="font-semibold">Demo data.</b> Connect Supabase and import a Figma file to see a real run.
              </Banner>
            ) : (
              <Banner tone="info">
                Auto layout drives the breakpoints, so responsive rules are derived rather than guessed.
              </Banner>
            )}
          </div>

          <div className="mt-auto p-6">
            {complete ? (
              <Link href="/dashboard/understanding" className={buttonClasses("primary", "lg", "w-full")}>
                Review what we found
              </Link>
            ) : failed ? (
              <Link href="/dashboard/import" className={buttonClasses("secondary", "lg", "w-full")}>
                Back to import
              </Link>
            ) : nothingYet ? (
              <Link href="/dashboard/understanding" className={buttonClasses("primary", "lg", "w-full")}>
                Run the analyst
              </Link>
            ) : (
              <div className="flex items-center gap-3 rounded-lg bg-bg-dark p-4 text-white">
                <AiGlyph size="lg" pulse />
                <p className="text-body font-medium">
                  Understanding your design system…
                  <span className="block text-caption font-normal text-content-on-dark">
                    Matching repeated frames against your existing component library.
                  </span>
                </p>
              </div>
            )}
          </div>
        </aside>
      </main>
    </div>
  );
}
