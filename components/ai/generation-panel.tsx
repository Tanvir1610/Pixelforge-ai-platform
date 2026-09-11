"use client";

import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { AiGlyph } from "@/components/ui/ai-glyph";
import { Progress } from "@/components/ui/progress";
import { StatusDot } from "@/components/ui/status";
import { cn, formatBytes } from "@/lib/utils";
import type { SequenceItem } from "@/hooks/use-sequence";

/**
 * The fixture file list, for the sample project only.
 *
 * This panel listed these four paths with these four diffs on every run, real
 * or not, under a heading that read "Files written 18" — and then finished with
 * "All 6 pages generated. 97% visual match against the original frames" for a
 * project that might have written nothing and has never been compared against
 * anything. Every one of those numbers is now read from the run.
 */
const SAMPLE_FILES = [
  { kind: "new", path: "app/page.tsx", diff: "+142" },
  { kind: "new", path: "components/Hero.tsx", diff: "+61" },
  { kind: "new", path: "components/Navbar.tsx", diff: "+48" },
  { kind: "edit", path: "app/globals.css", diff: "+27" },
];

export interface WrittenFile {
  path: string;
  bytes: number;
  /** "added" the first time a version writes it, "modified" after. */
  changeKind: "added" | "modified" | "deleted" | "unchanged";
}

/** Right rail during generation: exactly what the model is doing and what it wrote. */
export function GenerationPanel({
  tasks,
  percent,
  complete,
  failed = false,
  live = false,
  files,
  errorMessage,
}: {
  tasks: SequenceItem[];
  percent: number;
  complete: boolean;
  failed?: boolean;
  /** True when a real run backs this panel rather than the scripted sample. */
  live?: boolean;
  /** Files the newest version actually wrote. */
  files?: WrittenFile[];
  errorMessage?: string | null;
}) {
  const written = files ?? [];
  const totalBytes = written.reduce((total, file) => total + file.bytes, 0);

  return (
    <div className="flex flex-col gap-3.5 overflow-y-auto p-4 scrollbar-thin">
      <section className="rounded-[10px] border border-border p-3.5">
        <h3 className="mb-3 flex items-center justify-between text-body-sm font-semibold">
          {failed ? "Generation failed" : complete ? "Generation complete" : "Generating your website…"}
          <span className="font-mono font-medium text-accent">{percent}%</span>
        </h3>
        <Progress value={percent} className="mb-3" label="Generation progress" />
        {tasks.length === 0 ? (
          <p className="text-body-sm text-content-muted">
            No generation has run for this project yet.
          </p>
        ) : (
          <ul>
            {tasks.map((task) => (
              <li key={task.id} className={cn("flex items-center gap-2.5 py-1.5 text-body-sm", task.state === "pending" && "text-content-muted")}>
                <StatusDot state={task.state} />
                <span className="min-w-0 flex-1 truncate">{task.label}</span>
                {task.result && <span className="font-mono text-[11px] text-content-muted">{task.result}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-[10px] border border-border p-3.5">
        <h3 className="mb-3 flex items-center justify-between text-body-sm font-semibold">
          Files written
          <span className="text-caption font-normal text-content-muted">
            {live ? (written.length > 0 ? formatBytes(totalBytes) : "none") : SAMPLE_FILES.length}
          </span>
        </h3>

        {live && written.length === 0 ? (
          <p className="text-body-sm text-content-muted">
            Nothing written yet. Files appear here as each build step finishes.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {(live
              ? written.map((file) => ({
                  kind: file.changeKind === "added" ? "new" : "edit",
                  path: file.path,
                  diff: formatBytes(file.bytes),
                }))
              : SAMPLE_FILES
            ).map((file) => (
              <li key={file.path} className="flex items-center gap-2 text-body-sm">
                <Badge tone={file.kind === "new" ? "success" : "accent"} className="h-[18px] px-1.5 text-[11px]">
                  {file.kind}
                </Badge>
                <span className="min-w-0 flex-1 truncate font-mono text-caption" title={file.path}>{file.path}</span>
                <span className="shrink-0 font-mono text-[11px] text-content-muted">{file.diff}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Outcome
        live={live}
        complete={complete}
        failed={failed}
        fileCount={written.length}
        errorMessage={errorMessage}
      />
    </div>
  );
}

/**
 * What to say when the run ends.
 *
 * Never claims a visual match: nothing on this deployment compiles or
 * screenshots the generated site, so there is no measurement to report. It says
 * what was written, which is the part that did happen.
 */
function Outcome({ live, complete, failed, fileCount, errorMessage }: {
  live: boolean; complete: boolean; failed: boolean; fileCount: number; errorMessage?: string | null;
}) {
  if (failed) {
    return <Banner tone="error">{errorMessage ?? "The run stopped before it finished."}</Banner>;
  }

  if (!live) {
    return complete ? (
      <Banner tone="success">Sample run finished. Import your own design to generate real code.</Banner>
    ) : (
      <Banner tone="info">Sample run — nothing here was generated from a real design.</Banner>
    );
  }

  if (complete) {
    return (
      <Banner tone="success">
        {fileCount > 0
          ? `${fileCount} ${fileCount === 1 ? "file" : "files"} generated. Not compiled — this deployment has no build sandbox.`
          : "The run finished without writing any files."}
      </Banner>
    );
  }

  return <Banner tone="info">You can open finished files while the rest generate.</Banner>;
}

export function GenerationHeader({ complete, label }: { complete: boolean; label?: string }) {
  return (
    <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border px-4">
      <span className="flex items-center gap-2 text-body font-semibold">
        <AiGlyph size="lg" pulse={!complete} />
        Generation
      </span>
      {/* Was a fixed "Home" badge, which named a page no project necessarily has. */}
      {label && <Badge className="max-w-[140px] truncate">{label}</Badge>}
    </div>
  );
}
