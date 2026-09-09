"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

const QUESTIONS = [
  { q: "How close is the output to my design?", a: "Most files land between 95% and 99% visual match. The comparison screen scores spacing, typography, colour, layout and components separately so you can see exactly where the gap is and fix it." },
  { q: "What happens to my designs?", a: "Files are processed for your project only, never used for training, and removed from processing storage once generation completes." },
  { q: "Do I own the generated code?", a: "Yes. Export the repository or push to GitHub at any point. There is no runtime dependency on PixelForge." },
  { q: "Can I use my own component library?", a: "On Pro and Team you can map detected components to your existing library so generated pages import from your code instead of new files." },
  { q: "Which Figma features are supported?", a: "Auto layout, constraints, variables, component sets and variants, text styles, effects and exported assets. Plugins that rasterise their output come through as images." },
  { q: "What is an AI credit?", a: "One credit covers a single generation or refinement pass on a page. Analysis and preview are free." },
];

function Item({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = React.useState(false);
  const id = React.useId();

  return (
    <div className="border-t border-border">
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center justify-between gap-5 py-5 text-left text-[15px] font-medium"
        >
          {q}
          <ChevronDown aria-hidden className={cn("h-4 w-4 shrink-0 text-content-muted transition-transform", open && "rotate-180")} />
        </button>
      </h3>
      <div id={id} hidden={!open} className="max-w-[60ch] pb-5 text-body text-content-secondary">{a}</div>
    </div>
  );
}

export function Faq() {
  return (
    <section id="faq" className="mx-auto max-w-container px-5 py-16 md:px-10 md:py-20 lg:px-20">
      <h2 className="font-display text-[28px] font-bold tracking-[-0.025em] md:text-h1">Questions people ask first</h2>
      <div className="mt-10 grid gap-x-12 lg:grid-cols-2">
        <div>{QUESTIONS.slice(0, 3).map((item) => <Item key={item.q} {...item} />)}</div>
        <div>{QUESTIONS.slice(3).map((item) => <Item key={item.q} {...item} />)}</div>
      </div>
    </section>
  );
}
