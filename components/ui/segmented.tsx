"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface SegmentOption<T extends string> {
  value: T;
  label: React.ReactNode;
  icon?: React.ReactNode;
}

/**
 * Radio-group segmented control. Arrow keys move between options, matching the
 * WAI-ARIA radio pattern, so it is usable without a pointer.
 */
export function Segmented<T extends string>({
  options, value, onChange, label, size = "md", className,
}: {
  options: SegmentOption<T>[]; value: T; onChange: (value: T) => void;
  label: string; size?: "sm" | "md"; className?: string;
}) {
  function onKeyDown(event: React.KeyboardEvent) {
    const index = options.findIndex((option) => option.value === value);
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      onChange(options[(index + 1) % options.length].value);
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      onChange(options[(index - 1 + options.length) % options.length].value);
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn("inline-flex gap-0.5 rounded-md border border-border bg-bg-subtle p-0.5", className)}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(option.value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-sm px-2.5 transition-colors [&_svg]:h-3.5 [&_svg]:w-3.5",
              size === "sm" ? "h-6 text-caption" : "h-7 text-body-sm",
              active
                ? "bg-bg-surface font-medium text-content shadow-sm"
                : "text-content-muted hover:text-content",
            )}
          >
            {option.icon}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
