"use client";

import * as React from "react";
import { AlertTriangle, Check, GitBranch, Info, Layers, Zap } from "lucide-react";
import { WorkspaceShell } from "@/components/layout/workspace-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CodeBlock } from "@/components/sections/code-block";
import { EditorTabs } from "@/components/sections/editor-tabs";
import { CODE_FILES } from "@/lib/data";
import { cn } from "@/lib/utils";
import type { Project } from "@/types";

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

const AI_ACTIONS = [
  { label: "Explain", icon: Info }, { label: "Refactor", icon: Layers },
  { label: "Optimise", icon: Zap }, { label: "Fix", icon: AlertTriangle },
  { label: "Generate tests", icon: Check },
];

const OPEN_FILES = ["page.tsx", "Hero.tsx", "globals.css"];

export function CodeWorkspace({ project }: { project: Project }) {
  const [activeFile, setActiveFile] = React.useState("page.tsx");
  const source = CODE_FILES[activeFile] ?? CODE_FILES["page.tsx"];

  return (
    <WorkspaceShell
      project={project}
      status={
        <Badge className="hidden sm:inline-flex">
          <GitBranch aria-hidden className="h-3 w-3" />
          main
        </Badge>
      }
    >
      <div className="grid h-full min-h-0 bg-bg-dark lg:grid-cols-[240px_1fr_260px]">
        <nav aria-label="Files" className="hidden min-h-0 overflow-y-auto border-r border-border-dark py-2 scrollbar-thin lg:block">
          <h2 className="px-4 pb-1 pt-2.5 text-[11px] font-semibold text-[#6B7280]">
            {project.id}-marketing
          </h2>
          <ul>
            {TREE.map((node) => {
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
          <EditorTabs files={OPEN_FILES} active={activeFile} onSelect={setActiveFile} />
          <CodeBlock lines={source.lines} className="min-h-0 flex-1" />
          <div className="flex h-7 shrink-0 items-center gap-4 overflow-x-auto border-t border-border-dark bg-bg-dark-2 px-4 font-mono text-[11px] text-[#9CA3AF]">
            <span className="flex shrink-0 items-center gap-1.5 text-[#86EFAC]">
              <Check aria-hidden className="h-3 w-3" strokeWidth={3} />
              Build successful
            </span>
            <span className="shrink-0">TypeScript · no errors</span>
            <span className="shrink-0">Ln 22, Col 41</span>
            <span className="ml-auto hidden shrink-0 md:inline">Prettier · 2 spaces · UTF-8</span>
          </div>
        </main>

        <aside aria-label="AI actions" className="hidden min-h-0 flex-col gap-2 overflow-y-auto border-l border-border-dark p-4 scrollbar-thin lg:flex">
          <h2 className="mb-1 text-[11px] font-semibold text-[#6B7280]">AI actions</h2>
          {AI_ACTIONS.map((action) => {
            const Icon = action.icon;
            return (
              <Button
                key={action.label}
                size="sm"
                className="justify-start border border-[#2E2E2E] bg-[#1F1F1F] text-[#E5E7EB] hover:bg-[#262626] [&_svg]:text-[#9CA3AF]"
              >
                <Icon />
                {action.label}
              </Button>
            );
          })}

          <div className="mt-3">
            <h2 className="mb-1 text-[11px] font-semibold text-[#6B7280]">Selection</h2>
            <p className="text-caption leading-relaxed text-[#9CA3AF]">
              Lines 21–27 render the feature grid mapped from{" "}
              <code className="font-mono text-[#E5E7EB]">features</code>.
            </p>
          </div>

          <div className="mt-auto rounded-[10px] border border-[#2E2E2E] p-3 text-caption">
            <p className="mb-1.5 flex items-center gap-2 text-body-sm font-medium text-[#86EFAC]">
              <Check aria-hidden className="h-4 w-4" strokeWidth={3} />
              Build successful
            </p>
            <p className="font-mono text-[11px] leading-relaxed text-[#9CA3AF]">
              next build · 8.2s
              <br />
              4 routes · 0 warnings
              <br />
              First load JS 96 kB
            </p>
          </div>
        </aside>
      </div>
    </WorkspaceShell>
  );
}
