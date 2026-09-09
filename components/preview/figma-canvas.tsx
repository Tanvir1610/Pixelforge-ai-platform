import * as React from "react";
import { cn } from "@/lib/utils";

export interface DetectionRegion {
  name: string;
  top: string;
  height: string;
  left?: string;
  right?: string;
}

/** The dotted Figma surface, optionally overlaid with what the model detected. */
export function FigmaCanvas({
  children, regions, scanning = false, className,
}: {
  children: React.ReactNode; regions?: DetectionRegion[]; scanning?: boolean; className?: string;
}) {
  return (
    <div className={cn("canvas-dots relative overflow-hidden", className)}>
      {children}
      {regions?.map((region) => (
        <div
          key={region.name}
          className="absolute rounded-[4px] border-[1.5px] border-accent bg-accent/[.06]"
          style={{ top: region.top, height: region.height, left: region.left ?? "40px", right: region.right ?? "80px" }}
        >
          <span className="absolute -top-[22px] left-[-1px] rounded-[4px] bg-accent px-[7px] py-0.5 text-[11px] font-medium text-white">
            {region.name}
          </span>
        </div>
      ))}
      {scanning && (
        <div
          aria-hidden
          className="absolute inset-x-0 h-0.5 animate-scan bg-gradient-to-r from-transparent via-accent to-transparent shadow-[0_0_24px_4px_rgba(99,102,241,.35)]"
        />
      )}
    </div>
  );
}
