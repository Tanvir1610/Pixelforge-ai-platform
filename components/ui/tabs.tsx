"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export function Tabs<T extends string>({
  tabs, value, onChange, label, className,
}: {
  tabs: { value: T; label: React.ReactNode; count?: number }[];
  value: T; onChange: (value: T) => void; label: string; className?: string;
}) {
  return (
    <div role="tablist" aria-label={label} className={cn("flex gap-0.5 border-b border-border", className)}>
      {tabs.map((tab) => {
        const active = tab.value === value;
        return (
          <button
            key={tab.value}
            role="tab"
            type="button"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(tab.value)}
            className={cn(
              "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-body-sm font-medium transition-colors",
              active
                ? "border-bg-dark text-content"
                : "border-transparent text-content-muted hover:text-content",
            )}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span className="rounded-full bg-bg-subtle px-1.5 text-caption text-content-secondary">{tab.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
