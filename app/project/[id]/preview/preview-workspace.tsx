"use client";

import * as React from "react";
import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { WorkspaceShell } from "@/components/layout/workspace-shell";
import { ProjectTree } from "@/components/ai/file-tree";
import { GenerationHeader, GenerationPanel, type WrittenFile } from "@/components/ai/generation-panel";
import { ChatPanel } from "@/components/ai/chat-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { BrowserFrame } from "@/components/preview/browser-frame";
import { DeviceToolbar, type Zoom } from "@/components/preview/device-toolbar";
import { MiniSite, ScaledSite } from "@/components/preview/mini-site";
import { DesignPreview } from "@/components/preview/design-preview";
import type { FramePreview } from "@/lib/repositories/design-read";
import { useGenerationRun } from "@/hooks/use-generation-run";
import { useSequence } from "@/hooks/use-sequence";
import { GENERATION_TASKS } from "@/lib/data";
import type { GenerationRunRow, GenerationStepRow, RunStatus } from "@/lib/db/database.types";
import type { DeviceKey, Project } from "@/types";

const FRAME_WIDTH: Record<DeviceKey, number> = { desktop: 900, tablet: 640, mobile: 380 };

/** Maps a database run status onto the StatusDot vocabulary. */
function toDotState(status: RunStatus): "pending" | "active" | "done" | "failed" {
  if (status === "completed") return "done";
  if (status === "running") return "active";
  if (status === "failed" || status === "cancelled") return "failed";
  return "pending";
}

/**
 * The core three-panel workspace. Once generation finishes the right rail hands
 * over to the assistant, which is the natural next action at that point.
 *
 * The generation rail used to run `useSequence(GENERATION_TASKS)` on every
 * visit: opening this screen started a 1.6-second-per-step animation that
 * marched to "complete" and then showed a 97% match badge, whether or not
 * anything had ever been generated. It now watches the project's real run over
 * Realtime and shows nothing when there has not been one.
 */
export function PreviewWorkspace({
  project,
  assistantLive = false,
  assistantHistory,
  userInitials,
  files,
  writtenFiles,
  frame,
  generatedFileCount = 0,
  runId = null,
  initialRun,
  live = false,
  matchScore,
}: {
  project: Project;
  /** Real generated file paths; absent for the sample project. */
  files?: string[];
  /** The newest version's files, with what each one did. */
  writtenFiles?: WrittenFile[];
  /** The imported frame, drawn from its own geometry. */
  frame?: FramePreview | null;
  generatedFileCount?: number;
  /** The project's latest generation run, watched over Realtime. */
  runId?: string | null;
  initialRun?: { run: GenerationRunRow; steps: GenerationStepRow[] };
  /** True when a real project backs this screen. */
  live?: boolean;
  /** Only set once a comparison has actually measured one. */
  matchScore?: number | null;
  /** True when the assistant can answer about this project. */
  assistantLive?: boolean;
  assistantHistory?: { role: "user" | "assistant"; body: string }[];
  /** The signed-in user's initials, for their own messages in the thread. */
  userInitials?: string;
}) {
  const [device, setDevice] = React.useState<DeviceKey>("desktop");
  const [zoom, setZoom] = React.useState<Zoom>("75");
  // Null means "follow generation state"; an explicit choice by the user wins.
  const [chosenPanel, setChosenPanel] = React.useState<"generation" | "assistant" | null>(null);
  const [rebuildKey, setRebuildKey] = React.useState(0);
  const [showPanel, setShowPanel] = React.useState(true);

  const run = useGenerationRun(live ? runId : null, initialRun);
  // The scripted sequence animates for the sample project alone, and stays
  // stopped for a real one so nothing pretends to be in progress.
  const scripted = useSequence(GENERATION_TASKS, 1600, !live);

  const usingLive = live && Boolean(runId);

  const tasks = usingLive
    ? run.steps.map((step) => ({
        id: step.id,
        label: step.label,
        state: toDotState(step.status),
        result: step.result_summary ?? undefined,
      }))
    : live
      ? []
      : scripted.items;

  const percent = usingLive ? run.percent : live ? 0 : scripted.percent;
  const complete = usingLive ? run.complete : live ? generatedFileCount > 0 : scripted.complete;
  const failed = usingLive && run.failed;

  // Once generation finishes, the assistant is the natural next action, so the
  // panel switches over by default without an effect fighting user intent.
  const panel = chosenPanel ?? (complete ? "assistant" : "generation");

  const width = FRAME_WIDTH[device];
  const scale = (Number(zoom) / 100) * 2.4;

  return (
    <WorkspaceShell project={project} status={<PreviewStatus {...{ live, failed, complete, matchScore, generatedFileCount }} />}>
      <div className="grid h-full min-h-0 lg:grid-cols-[240px_1fr_380px]">
        <div className="hidden min-h-0 lg:block">
          <ProjectTree files={files} />
        </div>

        <div className="flex min-h-0 min-w-0 flex-col bg-bg-subtle">
          <DeviceToolbar
            device={device}
            onDeviceChange={setDevice}
            zoom={zoom}
            onZoomChange={setZoom}
            onRefresh={() => setRebuildKey((key) => key + 1)}
          />
          <main id="main" className="flex flex-1 justify-center overflow-auto p-6 scrollbar-thin">
            <BrowserFrame
              key={rebuildKey}
              // Was "northwind-preview.pixelforge.app" for every project — a
              // domain that does not exist, beside a padlock, above a page
              // nothing serves. It now says what is actually on screen.
              url={live ? `${project.name} — imported design (not served)` : "northwind-preview.pixelforge.app"}
              className="h-fit w-full"
              compact={device === "mobile"}
            >
              <div className="mx-auto flex flex-col items-center gap-2" style={{ maxWidth: width }}>
                {/* The imported design, drawn from its own nodes.
                    Not the generated site: rendering that needs it built and
                    served, which this deployment cannot do. A fabricated page
                    in its place — which is what this showed — is
                    indistinguishable from a working preview. */}
                {frame ? (
                  <>
                    <DesignPreview frame={frame} maxWidth={width} maxHeight={620} />
                    <p className="text-caption text-content-muted">
                      {frame.name} · imported design ·{" "}
                      {generatedFileCount > 0
                        ? `${generatedFileCount} files generated, not yet built`
                        : "nothing generated yet"}
                    </p>
                  </>
                ) : live ? (
                  <p className="max-w-[36ch] px-6 py-16 text-center text-body-sm text-content-muted">
                    No design imported for this project yet. Import a Figma file or upload a design
                    image and the frame appears here.
                  </p>
                ) : (
                  <ScaledSite scale={scale} width={width} height={620}>
                    <MiniSite brand={project.brand} headline={project.headline} device={device} dark={project.theme === "dark"} />
                  </ScaledSite>
                )}
              </div>
            </BrowserFrame>
          </main>
        </div>

        <aside
          className={`flex min-h-0 flex-col border-t border-border bg-bg-surface lg:border-l lg:border-t-0 ${showPanel ? "" : "hidden"}`}
          aria-label="AI panel"
        >
          <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border px-3">
            <Segmented
              label="Panel"
              size="sm"
              value={panel}
              onChange={setChosenPanel}
              options={[
                { value: "generation", label: "Generation" },
                { value: "assistant", label: "Assistant" },
              ]}
            />
            <Button variant="ghost" size="icon" aria-label="Hide panel" onClick={() => setShowPanel(false)}>
              <PanelRightClose />
            </Button>
          </div>

          {panel === "generation" ? (
            <>
              <GenerationHeader complete={complete} label={frame?.name} />
              <GenerationPanel
                tasks={tasks}
                percent={percent}
                complete={complete}
                failed={failed}
                live={live}
                files={writtenFiles}
                errorMessage={run.run?.error_message}
              />
            </>
          ) : (
            <ChatPanel live={assistantLive} history={assistantHistory} userInitials={userInitials} />
          )}
        </aside>

        {!showPanel && (
          <Button
            variant="secondary"
            size="icon"
            aria-label="Show panel"
            onClick={() => setShowPanel(true)}
            className="fixed bottom-5 right-5 z-dropdown shadow-lg"
          >
            <PanelRightOpen />
          </Button>
        )}
      </div>
    </WorkspaceShell>
  );
}

/**
 * The header badge.
 *
 * It read "{matchScore ?? 97}% match" as soon as the scripted sequence
 * finished, so every project ended up claiming a 97% visual match to a design
 * it had never been compared against. A score is only shown when a comparison
 * produced one.
 */
function PreviewStatus({ live, failed, complete, matchScore, generatedFileCount }: {
  live: boolean; failed: boolean; complete: boolean;
  matchScore?: number | null; generatedFileCount: number;
}) {
  if (failed) return <Badge tone="error">Generation failed</Badge>;

  if (!live) {
    return complete ? <Badge tone="neutral">Sample project</Badge> : <Badge tone="accent" dot>Generating</Badge>;
  }

  if (typeof matchScore === "number") {
    return <Badge tone="success" dot>{Math.round(matchScore)}% match</Badge>;
  }

  if (generatedFileCount > 0) {
    return <Badge tone="neutral">{generatedFileCount} files generated</Badge>;
  }

  return <Badge tone="neutral">Not generated</Badge>;
}
