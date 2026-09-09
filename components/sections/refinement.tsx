import { Check, Eye, Undo2 } from "lucide-react";
import { AiGlyph } from "@/components/ui/ai-glyph";
import { Button } from "@/components/ui/button";

const CHANGES = [
  { label: "Hero padding 96px → 76px at 768px", file: "Hero.tsx" },
  { label: "Display size 64px → 51px at 768px", file: "tokens.css" },
];

export function Refinement() {
  return (
    <section className="mx-auto max-w-container px-5 py-16 md:px-10 md:py-20 lg:px-20">
      <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
        <div className="flex flex-col gap-4 rounded-[14px] border border-border bg-bg-surface p-5 shadow-lg">
          <div>
            <p className="mb-1.5 text-caption font-semibold text-content-muted">You</p>
            <p className="inline-block rounded-[10px] bg-bg-subtle px-3.5 py-2.5 text-body">
              Make the hero section 20% smaller on tablet.
            </p>
          </div>
          <div className="flex gap-3">
            <AiGlyph size="lg" />
            <div className="min-w-0 flex-1">
              <p className="mb-1.5 text-caption font-semibold text-content-muted">PixelForge</p>
              <p className="text-body">Updated tablet breakpoint and regenerated the layout.</p>
              <ul className="mt-2.5 flex flex-col gap-1.5">
                {CHANGES.map((change) => (
                  <li key={change.file} className="flex items-center gap-2 rounded-md border border-border px-2.5 py-2 text-body-sm">
                    <span className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full bg-success-soft text-success-text">
                      <Check aria-hidden className="h-3 w-3" strokeWidth={3} />
                    </span>
                    <span className="min-w-0 flex-1 truncate">{change.label}</span>
                    <span className="font-mono text-[11px] text-content-muted">{change.file}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="primary" size="sm">Apply changes</Button>
                <Button variant="secondary" size="sm"><Eye />Preview</Button>
                <Button variant="ghost" size="sm"><Undo2 />Undo</Button>
              </div>
            </div>
          </div>
        </div>
        <div className="lg:order-first lg:hidden" />
        <div>
          <h2 className="font-display text-[28px] font-bold tracking-[-0.025em] md:text-h1">
            Refine in words, review as a diff
          </h2>
          <p className="mt-3 max-w-[46ch] text-body md:text-body-lg text-content-secondary">
            Describe the change you want. The assistant tells you exactly which files and values it intends to touch,
            and nothing lands until you approve it.
          </p>
        </div>
      </div>
    </section>
  );
}
