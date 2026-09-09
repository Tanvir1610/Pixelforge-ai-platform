"use client";

import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { AiGlyph } from "@/components/ui/ai-glyph";
import { Progress } from "@/components/ui/progress";
import { StatusDot } from "@/components/ui/status";
import { cn } from "@/lib/utils";
import type { SequenceItem } from "@/hooks/use-sequence";

const FILES_WRITTEN = [
  { kind: "new", path: "app/page.tsx", diff: "+142" },
  { kind: "new", path: "components/Hero.tsx", diff: "+61" },
  { kind: "new", path: "components/Navbar.tsx", diff: "+48" },
  { kind: "edit", path: "app/globals.css", diff: "+27" },
];

/** Right rail during generation: exactly what the model is doing and what it wrote. */
export function GenerationPanel({ tasks, percent, complete }: {
  tasks: SequenceItem[]; percent: number; complete: boolean;
}) {
  return (
    <div className="flex flex-col gap-3.5 overflow-y-auto p-4 scrollbar-thin">
      <section className="rounded-[10px] border border-border p-3.5">
        <h3 className="mb-3 flex items-center justify-between text-body-sm font-semibold">
          {complete ? "Generation complete" : "Generating your website…"}
          <span className="font-mono font-medium text-accent">{percent}%</span>
        </h3>
        <Progress value={percent} className="mb-3" label="Generation progress" />
        <ul>
          {tasks.map((task) => (
            <li key={task.id} className={cn("flex items-center gap-2.5 py-1.5 text-body-sm", task.state === "pending" && "text-content-muted")}>
              <StatusDot state={task.state} />
              <span className="min-w-0 flex-1 truncate">{task.label}</span>
              {task.result && <span className="font-mono text-[11px] text-content-muted">{task.result}</span>}
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-[10px] border border-border p-3.5">
        <h3 className="mb-3 flex items-center justify-between text-body-sm font-semibold">
          Files written
          <span className="text-caption font-normal text-content-muted">18</span>
        </h3>
        <ul className="flex flex-col gap-1.5">
          {FILES_WRITTEN.map((file) => (
            <li key={file.path} className="flex items-center gap-2 text-body-sm">
              <Badge tone={file.kind === "new" ? "success" : "accent"} className="h-[18px] px-1.5 text-[11px]">
                {file.kind}
              </Badge>
              <span className="min-w-0 flex-1 truncate font-mono text-caption">{file.path}</span>
              <span className="font-mono text-[11px] text-content-muted">{file.diff}</span>
            </li>
          ))}
        </ul>
      </section>

      {complete ? (
        <Banner tone="success">All 6 pages generated. 97% visual match against the original frames.</Banner>
      ) : (
        <Banner tone="info">You can start editing finished components while the rest generate.</Banner>
      )}
    </div>
  );
}

export function GenerationHeader({ complete }: { complete: boolean }) {
  return (
    <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border px-4">
      <span className="flex items-center gap-2 text-body font-semibold">
        <AiGlyph size="lg" pulse={!complete} />
        Generation
      </span>
      <Badge>Home</Badge>
    </div>
  );
}
