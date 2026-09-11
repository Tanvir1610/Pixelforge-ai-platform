"use client";

import * as React from "react";
import { Download, Wand2 } from "lucide-react";
import { WorkspaceShell } from "@/components/layout/workspace-shell";
import { AiGlyph } from "@/components/ui/ai-glyph";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Segmented } from "@/components/ui/segmented";
import { MiniSite, ScaledSite } from "@/components/preview/mini-site";
import { MATCH_METRICS, VISUAL_DIFFERENCES } from "@/lib/data";
import type { ComparisonSummary } from "@/lib/repositories/visual";
import { DesignPreview } from "@/components/preview/design-preview";
import type { FramePreview } from "@/lib/repositories/design-read";
import { cn } from "@/lib/utils";
import type { Project } from "@/types";

type Mode = "side" | "overlay" | "difference";

const OVERLAYS = [
  { id: "o1", label: "Padding 88 → 96px", top: "70px", height: "150px" },
  { id: "o2", label: "Gap 20 → 24px", top: "250px", height: "90px" },
];

/**
 * The differentiator screen: one headline score, five sub-scores and a list of
 * concrete differences that can be fixed in a single action.
 */
export function CompareWorkspace({
  project,
  comparisons = [],
  frame,
  live = false,
}: {
  project: Project;
  comparisons?: ComparisonSummary[];
  /** The imported frame — the left-hand "original" is this, not an invention. */
  frame?: FramePreview | null;
  live?: boolean;
}) {
  const [mode, setMode] = React.useState<Mode>("side");
  const [fixed, setFixed] = React.useState(false);
  const [fixing, setFixing] = React.useState(false);

  // A real project with no comparison has no score. Reporting the fixture's
  // 97% for something never built or screenshotted is the single most
  // misleading number this app could show.
  const latest = comparisons[0] ?? null;
  const hasScore = !live || latest !== null;

  const score = live
    ? Math.round(latest?.similarity ?? 0)
    : fixed ? 99 : (project.matchScore ?? 97);

  const metrics = live
    ? latest
      ? [
          { label: "Spacing", value: Math.round(latest.metrics.spacing) },
          { label: "Typography", value: Math.round(latest.metrics.typography) },
          { label: "Colour", value: Math.round(latest.metrics.color) },
          { label: "Layout", value: Math.round(latest.metrics.layout) },
          { label: "Components", value: Math.round(latest.metrics.components) },
        ]
      : []
    : fixed ? MATCH_METRICS.map((m) => ({ ...m, value: Math.min(100, m.value + 3) })) : MATCH_METRICS;

  // Region-level differences come from a comparison; without one there are none
  // to list rather than the fixture's invented three.
  const differences = live ? [] : fixed ? [] : VISUAL_DIFFERENCES;

  function fixDifferences() {
    setFixing(true);
    window.setTimeout(() => {
      setFixing(false);
      setFixed(true);
    }, 1400);
  }

  return (
    <WorkspaceShell project={project} status={<Badge>Home</Badge>}>
      <div className="grid h-full min-h-0 lg:grid-cols-[1fr_300px_1fr]">
        <section aria-label="Original Figma design" className="canvas-dots order-2 hidden min-h-0 flex-col gap-3 p-6 lg:order-none lg:flex">
          <h2 className="flex items-center justify-between text-body-sm font-semibold">
            Original Figma
            <Badge>Home / Desktop 1440</Badge>
          </h2>
          <div className="grid min-h-0 flex-1 place-items-center overflow-hidden rounded-[10px] border border-border bg-bg-surface shadow-md">
            {/* The real imported frame. This panel is labelled "Original Figma"
                and drew a fabricated marketing page, which made the comparison
                beside it meaningless even when a score existed. */}
            {frame ? (
              <DesignPreview frame={frame} maxWidth={520} maxHeight={540} />
            ) : (
              <ScaledSite scale={2} height={560}>
                <MiniSite brand={project.brand} headline={project.headline} dark={project.theme === "dark"} />
              </ScaledSite>
            )}
          </div>
        </section>

        <aside className="order-1 flex min-h-0 flex-col items-center gap-2 overflow-y-auto border-border bg-bg-surface p-6 scrollbar-thin lg:order-none lg:border-x">
          <div className="flex w-full items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-body font-semibold">
              <AiGlyph size="lg" />
              Visual match
            </span>
            <Segmented
              label="Comparison mode"
              size="sm"
              value={mode}
              onChange={setMode}
              options={[
                { value: "side", label: "Side" },
                { value: "overlay", label: "Overlay" },
                { value: "difference", label: "Diff" },
              ]}
            />
          </div>

          {/* No dial without a comparison. An empty ring reading 0% would look
              like a terrible match rather than an absent measurement. */}
          {hasScore ? (
            <div
              className="relative my-2 grid h-40 w-40 place-items-center rounded-full transition-all duration-700"
              style={{ background: `conic-gradient(var(--accent-primary) ${score}%, var(--bg-subtle) 0)` }}
              role="img"
              aria-label={`${score} percent visual match`}
            >
              <span aria-hidden className="absolute inset-3 rounded-full bg-bg-surface" />
              <span className="relative text-center">
                <b className="font-display text-[40px] font-bold leading-none tracking-[-0.03em]">{score}%</b>
                <span className="mt-0.5 block text-caption font-medium text-content-muted">
                  {differences.length === 0 ? "No differences" : `${differences.length} differences`}
                </span>
              </span>
            </div>
          ) : (
            <div className="my-2 grid h-40 w-40 place-items-center rounded-full border-[6px] border-dashed border-border text-center">
              <span className="px-4 text-caption text-content-muted">
                Not compared yet
              </span>
            </div>
          )}

          {!hasScore && (
            <p className="mb-2 px-2 text-center text-body-sm text-content-muted">
              A score needs the generated site built and screenshotted against your frames. This
              deployment has no build sandbox, so there is nothing to measure yet.
            </p>
          )}

          <ul className="mt-3 flex w-full flex-col gap-3">
            {metrics.map((metric) => (
              <li key={metric.label}>
                <div className="mb-1.5 flex items-center justify-between text-body-sm">
                  <span>{metric.label}</span>
                  <b className="font-mono text-caption font-medium">{metric.value}%</b>
                </div>
                <Progress
                  value={metric.value}
                  label={`${metric.label} match`}
                  barClassName={metric.value < 96 ? "bg-warning" : "bg-bg-dark"}
                />
              </li>
            ))}
          </ul>

          {differences.length > 0 ? (
            <ul className="mt-3.5 w-full overflow-hidden rounded-[10px] border border-border text-body-sm">
              {differences.map((difference) => (
                <li key={difference.id} className="flex items-center gap-2 border-b border-border px-3 py-2.5 last:border-b-0">
                  <span
                    aria-hidden
                    className={cn("h-2 w-2 shrink-0 rounded-full", difference.severity === "high" ? "bg-error" : "bg-warning")}
                  />
                  <span className="min-w-0 flex-1 truncate">{difference.label}</span>
                  <span className="font-mono text-[11px] text-content-muted">{difference.detail}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Banner tone="success" className="mt-3.5 w-full">
              All differences fixed. Visual match went from {project.matchScore ?? 97}% to 99%.
            </Banner>
          )}

          <div className="mt-4 flex w-full flex-col gap-1.5">
            <Button variant="primary" onClick={fixDifferences} loading={fixing} disabled={differences.length === 0}>
              <Wand2 />
              Fix differences
            </Button>
            <Button variant="ghost" size="sm">
              <Download />
              Export comparison report
            </Button>
          </div>
        </aside>

        <section aria-label="Generated website" className="order-3 flex min-h-0 flex-col gap-3 bg-bg-subtle p-6 lg:order-none">
          <h2 className="flex items-center justify-between text-body-sm font-semibold">
            Generated website
            {/* "Live preview" over a fabricated page was the claim that made
                this screen dishonest: nothing is served, so nothing is live. */}
            {live ? (
              <Badge tone="neutral">Not rendered</Badge>
            ) : (
              <Badge tone="success" dot>Live preview</Badge>
            )}
          </h2>
          <div className="relative grid min-h-0 flex-1 place-items-center overflow-hidden rounded-[10px] border border-border bg-bg-surface shadow-md">
            {live ? (
              <p className="max-w-[34ch] px-6 text-center text-body-sm text-content-muted">
                The generated site isn&apos;t rendered here. Showing it needs the project built and served,
                which this deployment has no sandbox for — so there is nothing to put beside your design yet.
              </p>
            ) : (
              <ScaledSite scale={2} height={560}>
                <MiniSite brand={project.brand} headline={project.headline} dark={project.theme === "dark"} />
              </ScaledSite>
            )}
            {!fixed && !live &&
              OVERLAYS.map((overlay) => (
                <div
                  key={overlay.id}
                  className="pointer-events-none absolute inset-x-6 rounded-[4px] border-[1.5px] border-dashed border-error bg-error/5"
                  style={{ top: overlay.top, height: overlay.height }}
                >
                  <span className="absolute -top-5 left-0 whitespace-nowrap rounded-[4px] bg-error px-1.5 py-0.5 text-[10px] text-white">
                    {overlay.label}
                  </span>
                </div>
              ))}
          </div>
        </section>
      </div>
    </WorkspaceShell>
  );
}
