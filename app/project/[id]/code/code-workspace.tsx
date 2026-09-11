"use client";

import * as React from "react";
import { AlertTriangle, Check, Download, GitBranch, Info, Layers, Zap } from "lucide-react";
import { WorkspaceShell } from "@/components/layout/workspace-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CodeBlock } from "@/components/sections/code-block";
import { EditorTabs } from "@/components/sections/editor-tabs";
import { CODE_FILES } from "@/lib/data";
import type { LatestCodeVersion, VersionSummary } from "@/lib/repositories/code";
import { VersionHistory } from "@/components/code/version-history";
import { askAssistantAction } from "@/lib/actions/assistant";
import { cn } from "@/lib/utils";
import type { Project } from "@/types";

/** Named, because a literal escape here has been mangled by tooling before. */
const NEWLINE = String.fromCharCode(10);

/** Swatch colour per file kind, matching the fixture tree's vocabulary. */
function kindOf(path: string): "dir" | "file" | "css" | "ts" {
  if (path.endsWith(".css") || path.endsWith(".scss")) return "css";
  if (path.endsWith(".ts") || path.endsWith(".json")) return "ts";
  return "file";
}

const TREE = [
  { name: "app", type: "dir" as const },
  { name: "page.tsx", type: "file" as const, indent: true, file: "page.tsx" },
  { name: "layout.tsx", type: "file" as const, indent: true },
  { name: "globals.css", type: "css" as const, indent: true, file: "globals.css" },
  { name: "components", type: "dir" as const },
  { name: "Hero.tsx", type: "file" as const, indent: true, file: "Hero.tsx" },
  { name: "Navbar.tsx", type: "file" as const, indent: true },
  { name: "FeatureCard.tsx", type: "file" as const, indent: true },
  { name: "Footer.tsx", type: "file" as const, indent: true },
  { name: "lib", type: "dir" as const },
  { name: "tokens.ts", type: "ts" as const, indent: true },
  { name: "tailwind.config.ts", type: "ts" as const },
  { name: "package.json", type: "ts" as const },
];

/**
 * What each action actually asks.
 *
 * These five buttons had no `onClick`. They rendered, they hovered, and nothing
 * happened — decoration shaped like a feature. Each now sends the open file to
 * the refinement assistant, which is advisory: it says what it would change and
 * where, and applying it stays a separate, explicit step.
 */
const AI_ACTIONS = [
  { label: "Explain", icon: Info, prompt: "Explain what this file does, section by section. Be brief." },
  { label: "Refactor", icon: Layers, prompt: "Suggest refactors for this file. Name the exact lines and say why each one is worth doing." },
  { label: "Optimise", icon: Zap, prompt: "Find performance problems in this file — re-renders, bundle weight, unnecessary work. Skip anything that is already fine." },
  { label: "Fix", icon: AlertTriangle, prompt: "Find bugs, accessibility problems and type errors in this file. If there are none, say so." },
  { label: "Generate tests", icon: Check, prompt: "Write the tests this file needs. Give the test file's path and its full contents." },
];

const OPEN_FILES = ["page.tsx", "Hero.tsx", "globals.css"];

/**
 * Real generated files when the project has any, the fixture set otherwise.
 *
 * This screen rendered four fixed files regardless, so a project that had
 * generated nothing showed a finished Next.js app.
 */
export function CodeWorkspace({
  project,
  version,
  versions = [],
}: {
  project: Project;
  version?: LatestCodeVersion | null;
  /** Every version of this project, newest first. Empty for the sample. */
  versions?: VersionSummary[];
}) {
  const live = Boolean(version && version.files.length > 0);

  const tree = React.useMemo(
    () =>
      live
        ? version!.files.map((file) => ({
            name: file.path.split("/").pop() ?? file.path,
            type: kindOf(file.path),
            file: file.path,
            indent: file.path.includes("/"),
          }))
        : TREE,
    [live, version],
  );

  const [activeFile, setActiveFile] = React.useState(
    () => (live ? (version!.files[0]?.path ?? "page.tsx") : "page.tsx"),
  );

  const source = React.useMemo(() => {
    if (!live) return CODE_FILES[activeFile] ?? CODE_FILES["page.tsx"];

    const file = version!.files.find((entry) => entry.path === activeFile) ?? version!.files[0];
    return {
      language: file?.language ?? "typescript",
      // Content is null for a file held in object storage rather than inline.
      lines: (file?.content ?? "// Stored outside the row — open it from the version history.").split(NEWLINE),
    };
  }, [live, version, activeFile]);

  // Which action is in flight, and what came back. One at a time: each is a
  // metered model call, and five parallel ones would just burn credits.
  const [asking, setAsking] = React.useState<string | null>(null);
  const [reply, setReply] = React.useState<
    { title: string; body: string; status?: string; ok: boolean } | null
  >(null);

  async function ask(label: string, prompt: string) {
    const content = version?.files.find((entry) => entry.path === activeFile)?.content;
    if (!content) {
      setReply({
        title: label,
        ok: false,
        body: "That file's contents are in object storage rather than inline, so it can't be sent for review from here.",
      });
      return;
    }

    setAsking(label);
    setReply(null);
    try {
      const result = await askAssistantAction({ prompt, file: { path: activeFile, content } });
      setReply({ title: `${label} · ${activeFile}`, body: result.message, status: result.status, ok: result.ok });
    } catch {
      setReply({ title: label, ok: false, body: "The request didn't get through. Try again in a moment." });
    } finally {
      setAsking(null);
    }
  }

  return (
    <WorkspaceShell
      project={project}
      status={
        // Was a "main" branch badge. Nothing here is in a repository — there is
        // no GitHub integration on this deployment — so it named a branch that
        // does not exist. The version number is the real identifier.
        live ? (
          <Badge className="hidden sm:inline-flex">
            <GitBranch aria-hidden className="h-3 w-3" />
            v{version!.versionNumber}
          </Badge>
        ) : (
          <Badge tone="neutral" className="hidden sm:inline-flex">Sample project</Badge>
        )
      }
    >
      <div className="grid h-full min-h-0 bg-bg-dark lg:grid-cols-[240px_1fr_260px]">
        <nav aria-label="Files" className="hidden min-h-0 overflow-y-auto border-r border-border-dark py-2 scrollbar-thin lg:block">
          <h2 className="px-4 pb-1 pt-2.5 text-[11px] font-semibold text-[#6B7280]">
            {live ? `${project.name} · v${version!.versionNumber}` : `${project.id}-marketing`}
          </h2>
          <ul>
            {tree.map((node) => {
              const active = node.file === activeFile;
              return (
                <li key={node.name}>
                  <button
                    type="button"
                    onClick={() => node.file && setActiveFile(node.file)}
                    disabled={!node.file}
                    aria-current={active ? "true" : undefined}
                    className={cn(
                      "flex w-full items-center gap-2 px-4 py-1 text-left text-body-sm transition-colors",
                      node.indent && "pl-8",
                      active ? "bg-[#262626] text-white" : "text-[#9CA3AF] hover:text-white",
                      !node.file && "cursor-default",
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "h-2 w-2 shrink-0 rounded-[2px]",
                        node.type === "dir" && "border border-[#6B7280] bg-transparent",
                        node.type === "file" && "bg-[#3B82F6]",
                        node.type === "css" && "bg-[#A78BFA]",
                        node.type === "ts" && "bg-[#60A5FA]",
                      )}
                    />
                    <span className="truncate">{node.name}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <main id="main" className="flex min-h-0 min-w-0 flex-col">
          <EditorTabs
            files={live ? version!.files.slice(0, 3).map((file) => file.path) : OPEN_FILES}
            active={activeFile}
            onSelect={setActiveFile}
          />
          <CodeBlock lines={source.lines} className="min-h-0 flex-1" />
          {/* Never claims a build. Generation on this deployment does not compile
              anything, and a green "Build successful" over uncompiled output is
              the most misleading thing this screen could say. */}
          <div className="flex h-7 shrink-0 items-center gap-4 overflow-x-auto border-t border-border-dark bg-bg-dark-2 px-4 font-mono text-[11px] text-[#9CA3AF]">
            {live ? (
              <>
                <span className="flex shrink-0 items-center gap-1.5 text-[#FCD34D]">
                  <AlertTriangle aria-hidden className="h-3 w-3" />
                  Not compiled
                </span>
                <span className="shrink-0">{version!.files.length} files · v{version!.versionNumber}</span>
                <span className="ml-auto hidden shrink-0 md:inline">Generated · not yet built</span>
              </>
            ) : (
              <>
                <span className="flex shrink-0 items-center gap-1.5 text-[#86EFAC]">
                  <Check aria-hidden className="h-3 w-3" strokeWidth={3} />
                  Build successful
                </span>
                <span className="shrink-0">Sample project</span>
                <span className="ml-auto hidden shrink-0 md:inline">Prettier · 2 spaces · UTF-8</span>
              </>
            )}
          </div>
        </main>

        <aside aria-label="AI actions" className="hidden min-h-0 flex-col gap-2 overflow-y-auto border-l border-border-dark p-4 scrollbar-thin lg:flex">
          {/* The one thing a user most wants from this screen, and the one
              thing it could not do: get the code out. */}
          {live && (
            <a
              href={`/api/projects/${project.id}/download`}
              className="mb-1 flex items-center gap-2 rounded-md border border-[#2E2E2E] bg-[#1F1F1F] px-3 py-2 text-body-sm font-medium text-[#E5E7EB] transition-colors hover:bg-[#262626]"
            >
              <Download aria-hidden className="h-4 w-4 text-[#9CA3AF]" />
              Download source
            </a>
          )}

          <h2 className="mb-1 text-[11px] font-semibold text-[#6B7280]">AI actions</h2>
          {AI_ACTIONS.map((action) => {
            const Icon = action.icon;
            return (
              <Button
                key={action.label}
                size="sm"
                onClick={() => ask(action.label, action.prompt)}
                loading={asking === action.label}
                // Nothing to reason about without a real file in the editor.
                disabled={!live || asking !== null}
                className="justify-start border border-[#2E2E2E] bg-[#1F1F1F] text-[#E5E7EB] hover:bg-[#262626] [&_svg]:text-[#9CA3AF]"
              >
                <Icon />
                {action.label}
              </Button>
            );
          })}

          {!live && (
            <p className="text-caption leading-relaxed text-[#6B7280]">
              These act on generated code. Import a design and generate to use them.
            </p>
          )}

          {reply && (
            <div className="mt-2 rounded-[10px] border border-[#2E2E2E] bg-[#1A1A1A] p-3">
              <h3 className="mb-1.5 flex items-center justify-between gap-2 text-[11px] font-semibold text-[#6B7280]">
                {reply.title}
                <button
                  type="button"
                  onClick={() => setReply(null)}
                  className="font-normal text-[#6B7280] hover:text-[#E5E7EB]"
                >
                  Dismiss
                </button>
              </h3>
              <p className={cn(
                "whitespace-pre-wrap text-caption leading-relaxed",
                reply.ok ? "text-[#D1D5DB]" : "text-[#FCA5A5]",
              )}>
                {reply.body}
              </p>
              {reply.status && (
                <p className="mt-2 font-mono text-[10px] text-[#6B7280]">{reply.status}</p>
              )}
            </div>
          )}

          {/* The history was written from the first generation and reachable
              from nowhere, which made every generation final. */}
          {live && versions.length > 0 && (
            <div className="mt-3 rounded-[10px] border border-[#2E2E2E] bg-[#1A1A1A] p-3 [&_*]:text-[#E5E7EB] [&_time]:text-[#9CA3AF]">
              <h2 className="mb-1.5 text-[11px] font-semibold text-[#6B7280]">Version history</h2>
              <VersionHistory versions={versions} />
            </div>
          )}

          {/* A "Selection" panel used to sit here reading "Lines 21–27 render
              the feature grid mapped from features" — fixed text about a file
              the open project need not contain. The open file's own facts
              replace it. */}
          {live && (
            <div className="mt-3">
              <h2 className="mb-1 text-[11px] font-semibold text-[#6B7280]">Open file</h2>
              <p className="text-caption leading-relaxed text-[#9CA3AF]">
                <code className="font-mono text-[#E5E7EB]">{activeFile}</code>
                <br />
                {source.lines.length} lines · {source.language}
              </p>
            </div>
          )}

          <div className="mt-auto rounded-[10px] border border-[#2E2E2E] p-3 text-caption">
            <p className={cn(
              "mb-1.5 flex items-center gap-2 text-body-sm font-medium",
              live ? "text-[#FCD34D]" : "text-[#86EFAC]",
            )}>
              {live ? <AlertTriangle aria-hidden className="h-4 w-4" /> : <Check aria-hidden className="h-4 w-4" strokeWidth={3} />}
              {live ? "Not compiled" : "Build successful"}
            </p>
            <p className="font-mono text-[11px] leading-relaxed text-[#9CA3AF]">
              {live ? (
                <>
                  {version!.files.length} files · v{version!.versionNumber}
                  <br />
                  {version!.label ?? "generated"}
                  <br />
                  no sandbox on this deployment
                </>
              ) : (
                <>
                  next build · 8.2s
                  <br />
                  4 routes · 0 warnings
                  <br />
                  First load JS 96 kB
                </>
              )}
            </p>
          </div>
        </aside>
      </div>
    </WorkspaceShell>
  );
}
