"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { MiniSite, ScaledSite } from "@/components/preview/mini-site";

const BRAND = "Northwind";
const HEADLINE = "Ship your ideas without the rebuild.";

/**
 * Draggable before/after comparison. The handle is a real slider input so it
 * responds to arrow keys and reports its value to assistive technology.
 */
export function BeforeAfter() {
  const [position, setPosition] = React.useState(50);

  return (
    <section className="mx-auto max-w-container px-5 py-16 md:px-10 md:py-20 lg:px-20">
      <h2 className="font-display text-[28px] font-bold tracking-[-0.025em] md:text-h1">
        Compare the file against the build
      </h2>
      <p className="mt-3 max-w-prose text-body md:text-body-lg text-content-secondary">
        Drag the handle to check the generated site against the original frame, pixel for pixel.
      </p>

      <div className="relative mt-12 h-[380px] overflow-hidden rounded-[14px] border border-border bg-bg-surface md:h-[460px]">
        <div className="canvas-dots absolute inset-0 p-7">
          <span className="absolute left-4 top-4 z-10 rounded-full border border-border bg-bg-surface px-2.5 py-1 text-caption font-medium shadow-sm">
            Figma design
          </span>
          <ScaledSite scale={1.55} height={400} className="h-full border border-[#DADADA]">
            <MiniSite brand={BRAND} headline={HEADLINE} />
          </ScaledSite>
        </div>

        <div className="absolute inset-0 overflow-hidden" style={{ clipPath: `inset(0 0 0 ${position}%)` }}>
          <div className="absolute inset-0 bg-bg-surface">
            <span className="absolute right-4 top-4 z-10 rounded-full border border-border bg-bg-surface px-2.5 py-1 text-caption font-medium shadow-sm">
              Generated website
            </span>
            <ScaledSite scale={1.55} height={400} className="h-full">
              <MiniSite brand={BRAND} headline={HEADLINE} />
            </ScaledSite>
          </div>
        </div>

        <div aria-hidden className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-bg-dark" style={{ left: `${position}%` }}>
          <span className="absolute left-1/2 top-1/2 grid h-10 w-10 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-bg-dark text-white shadow-lg">
            <ChevronLeft className="h-3.5 w-3.5" />
            <ChevronRight className="absolute h-3.5 w-3.5 translate-x-1.5" />
          </span>
        </div>

        <input
          type="range"
          min={0}
          max={100}
          value={position}
          onChange={(event) => setPosition(Number(event.target.value))}
          aria-label="Reveal the generated website"
          className="absolute inset-0 h-full w-full cursor-ew-resize opacity-0"
        />
      </div>
    </section>
  );
}
