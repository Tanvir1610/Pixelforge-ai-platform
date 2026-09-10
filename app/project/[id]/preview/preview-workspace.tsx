"use client";

import * as React from "react";
import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { WorkspaceShell } from "@/components/layout/workspace-shell";
import { ProjectTree } from "@/components/ai/file-tree";
import { GenerationHeader, GenerationPanel } from "@/components/ai/generation-panel";
import { ChatPanel } from "@/components/ai/chat-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { BrowserFrame } from "@/components/preview/browser-frame";
import { DeviceToolbar, type Zoom } from "@/components/preview/device-toolbar";
import { MiniSite, ScaledSite } from "@/components/preview/mini-site";
import { useSequence } from "@/hooks/use-sequence";
import { GENERATION_TASKS } from "@/lib/data";
import type { DeviceKey, Project } from "@/types";

const FRAME_WIDTH: Record<DeviceKey, number> = { desktop: 900, tablet: 640, mobile: 380 };

/**
 * The core three-panel workspace. Once generation finishes the right rail hands
 * over to the assistant, which is the natural next action at that point.
 */
export function PreviewWorkspace({
  project,
  assistantLive = false,
  assistantHistory,
}: {
  project: Project;
  /** True when a real project backs this screen, so the assistant can answer. */
  assistantLive?: boolean;
  assistantHistory?: { role: "user" | "assistant"; body: string }[];
}) {
  const [device, setDevice] = React.useState<DeviceKey>("desktop");
  const [zoom, setZoom] = React.useState<Zoom>("75");
  // Null means "follow generation state"; an explicit choice by the user wins.
  const [chosenPanel, setChosenPanel] = React.useState<"generation" | "assistant" | null>(null);
  const [rebuildKey, setRebuildKey] = React.useState(0);
  const [showPanel, setShowPanel] = React.useState(true);
  const { items, percent, complete } = useSequence(GENERATION_TASKS, 1600);

  // Once generation finishes, the assistant is the natural next action, so the
  // panel switches over by default without an effect fighting user intent.
  const panel = chosenPanel ?? (complete ? "assistant" : "generation");

  const width = FRAME_WIDTH[device];
  const scale = (Number(zoom) / 100) * 2.4;

  return (
    <WorkspaceShell
      project={project}
      status={
        complete ? (
          <Badge tone="success" dot>{project.matchScore ?? 97}% match</Badge>
        ) : (
          <Badge tone="accent" dot>Generating</Badge>
        )
      }
    >
      <div className="grid h-full min-h-0 lg:grid-cols-[240px_1fr_380px]">
        <div className="hidden min-h-0 lg:block">
          <ProjectTree />
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
              url="northwind-preview.pixelforge.app"
              className="h-fit w-full"
              compact={device === "mobile"}
            >
              <div className="mx-auto" style={{ maxWidth: width }}>
                <ScaledSite scale={scale} width={width} height={620}>
                  <MiniSite brand={project.brand} headline={project.headline} device={device} dark={project.theme === "dark"} />
                </ScaledSite>
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
              <GenerationHeader complete={complete} />
              <GenerationPanel tasks={items} percent={percent} complete={complete} />
            </>
          ) : (
            <ChatPanel live={assistantLive} history={assistantHistory} />
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
