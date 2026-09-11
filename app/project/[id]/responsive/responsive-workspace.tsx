"use client";

import * as React from "react";
import Link from "next/link";
import { Monitor, Plus, Smartphone, Tablet } from "lucide-react";
import { WorkspaceShell } from "@/components/layout/workspace-shell";
import { AiGlyph } from "@/components/ui/ai-glyph";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { MiniSite, ScaledSite } from "@/components/preview/mini-site";
import { DesignPreview } from "@/components/preview/design-preview";
import type { FramePreview } from "@/lib/repositories/design-read";
import { DEVICES, RESPONSIVE_RULES } from "@/lib/data";
import type { DeviceKey, Project } from "@/types";

const ICONS: Record<DeviceKey, React.ElementType> = { desktop: Monitor, tablet: Tablet, mobile: Smartphone };

const FRAME: Record<DeviceKey, { box: number; scale: number; note: string; derived: boolean }> = {
  desktop: { box: 620, scale: 1.55, note: "3-column grid · padding 80", derived: false },
  tablet: { box: 340, scale: 1.05, note: "2-column grid · padding 40", derived: true },
  mobile: { box: 230, scale: 0.72, note: "1 column · padding 20", derived: true },
};

/** The imported frame whose width is closest to a breakpoint. */
function nearestPreview(previews: FramePreview[], width: number): FramePreview | null {
  if (previews.length === 0) return null;
  return previews.reduce((best, candidate) =>
    Math.abs(candidate.width - width) < Math.abs(best.width - width) ? candidate : best,
  );
}

export function ResponsiveWorkspace({
  project,
  frames = [],
  previews = [],
  live = false,
}: {
  project: Project;
  /** The project's own frames, which is where real breakpoints come from. */
  frames?: { id: string; name: string; width: number; height: number; breakpoint: number | null }[];
  /** Drawable frames, widest first — one per breakpoint the design actually has. */
  previews?: FramePreview[];
  live?: boolean;
}) {
  const [mode, setMode] = React.useState<"single" | "all">("all");
  const [single, setSingle] = React.useState<DeviceKey>("tablet");

  /**
   * The widths to show.
   *
   * DEVICES is a fixed desktop/tablet/mobile list, so a design drawn at 1512,
   * 834 and 430 was displayed under headings claiming 1440, 768 and 390. A
   * project's own frame widths are the only honest answer; the fixed list is
   * for the sample project, which has no frames.
   */
  const devices = React.useMemo(() => {
    if (!live || frames.length === 0) return DEVICES;

    return [...frames]
      .sort((a, b) => b.width - a.width)
      .map((frame) => ({
        key: (frame.width >= 1024 ? "desktop" : frame.width >= 600 ? "tablet" : "mobile") as DeviceKey,
        label: frame.name,
        width: Math.round(frame.width),
      }));
  }, [live, frames]);

  const shown = mode === "all" ? devices : devices.filter((device) => device.key === single);

  return (
    <WorkspaceShell
      project={project}
      status={
        // Was a fixed "Home" badge naming a page no project need have.
        <Badge tone="neutral">
          {live
            ? `${frames.length} ${frames.length === 1 ? "frame" : "frames"}`
            : "Sample project"}
        </Badge>
      }
    >
      <div className="flex h-full min-h-0 flex-col bg-bg-subtle">
        <div className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-border bg-bg-surface px-4">
          <Segmented
            label="Comparison mode"
            value={mode}
            onChange={setMode}
            options={[
              { value: "single", label: "Single device" },
              { value: "all", label: "Compare all" },
            ]}
          />
          <div className="flex items-center gap-2">
            {mode === "single" && (
              <Segmented
                label="Device"
                value={single}
                onChange={setSingle}
                options={devices.map((device) => ({
                  value: device.key,
                  label: device.label,
                  icon: React.createElement(ICONS[device.key]),
                }))}
              />
            )}
            {/* An "Add breakpoint" button sat here with no handler. Breakpoints
                come from the frames a designer drew, so the way to add one is
                to import that frame. */}
            <Link href="/dashboard/import" className={buttonClasses("secondary", "sm")}>
              <Plus />
              Import a frame
            </Link>
          </div>
        </div>

        <main id="main" className="min-h-0 flex-1 overflow-auto p-6 scrollbar-thin">
          <ul className="flex flex-wrap items-start gap-6">
            {shown.map((device) => {
              const frame = FRAME[device.key];
              const Icon = ICONS[device.key];
              return (
                <li
                  key={device.key}
                  className="shrink-0 overflow-hidden rounded-lg border border-border bg-bg-surface shadow-md"
                  style={{ width: mode === "all" ? frame.box : 680 }}
                >
                  <div className="flex h-8 items-center justify-between border-b border-border px-3 text-caption font-medium">
                    <span className="flex items-center gap-1.5">
                      <Icon aria-hidden className="h-3.5 w-3.5" />
                      {device.label}
                    </span>
                    <span className="font-mono font-normal text-content-muted">{device.width}px</span>
                  </div>
                  {/* The real frame closest to this breakpoint's width, drawn
                      from its own nodes. A fabricated page rendered at three
                      sizes told you nothing about your design. */}
                  {live ? (
                    (() => {
                      const match = nearestPreview(previews, device.width);
                      return match ? (
                        <div className="grid place-items-center bg-bg-subtle p-3">
                          <DesignPreview
                            frame={match}
                            maxWidth={(mode === "all" ? frame.box : 680) - 24}
                            maxHeight={340}
                          />
                        </div>
                      ) : (
                        <div className="grid h-[340px] place-items-center px-4 text-center text-caption text-content-muted">
                          No imported frame near {device.width}px.
                        </div>
                      );
                    })()
                  ) : (
                    <ScaledSite scale={mode === "all" ? frame.scale : frame.scale * 1.4} height={340}>
                      <MiniSite
                        brand={project.brand}
                        headline={project.headline}
                        device={device.key}
                        dark={project.theme === "dark"}
                      />
                    </ScaledSite>
                  )}
                  <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2.5">
                    {live ? (
                      (() => {
                        const match = nearestPreview(previews, device.width);
                        return (
                          <>
                            <span className="truncate text-caption text-content-muted">
                              {match ? `${match.name} · ${match.width}×${match.height}` : "no frame"}
                            </span>
                            {/* "Matches frame" only when the design really has
                                one at this width; anything else is scaled. */}
                            <Badge tone={match?.width === device.width ? "success" : "accent"} dot={match?.width === device.width}>
                              {match?.width === device.width ? "Matches frame" : "Scaled"}
                            </Badge>
                          </>
                        );
                      })()
                    ) : (
                      <>
                        <span className="truncate text-caption text-content-muted">{frame.note}</span>
                        <Badge tone={frame.derived ? "accent" : "success"} dot={!frame.derived}>
                          {frame.derived ? "Derived" : "Matches frame"}
                        </Badge>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </main>

        <aside className="m-6 mt-0 flex shrink-0 flex-wrap items-start gap-3 rounded-lg border border-border bg-bg-surface p-4 shadow-md">
          <AiGlyph size="lg" />
          <div className="min-w-[240px] flex-1">
            {/* Rules are derived from auto layout and constraints during
                generation. Stating invented ones for a project that has none
                described behaviour nobody had computed. */}
            {live ? (
              <>
                <p className="text-[13.5px]">
                  {frames.length > 0
                    ? `Imported at ${frames.length} ${frames.length === 1 ? "frame" : "frames"}. Breakpoints are taken from the widths your frames were drawn at.`
                    : "No frames imported yet, so there are no breakpoints to derive rules from."}
                </p>
                {frames.length > 0 && (
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {frames.map((frame) => (
                      <li key={frame.id}>
                        <Badge className="font-mono">
                          {frame.name} · {Math.round(frame.width)}px
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <>
                <p className="text-[13.5px]">
                  Based on your Figma constraints, the card grid collapses to one column below 640px. The navbar links
                  move into a menu at 768px because the horizontal auto layout would otherwise overflow at 704px.
                </p>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {RESPONSIVE_RULES.map((rule) => (
                    <li key={rule}>
                      <Badge className="font-mono">{rule}</Badge>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
          {/* An "Edit rules" button used to sit here for the sample, with
              nothing behind it. */}
        </aside>
      </div>
    </WorkspaceShell>
  );
}
