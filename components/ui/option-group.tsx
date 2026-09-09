"use client";

import { cn } from "@/lib/utils";

export interface OptionItem<T extends string> {
  value: T;
  label: string;
  swatch: string;
}

/** Radio group rendered as swatch chips — used for framework, styling and host pickers. */
export function OptionGroup<T extends string>({
  options, value, onChange, label, columns = 4,
}: {
  options: OptionItem<T>[]; value: T; onChange: (value: T) => void; label: string; columns?: number;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="grid gap-2"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "flex items-center gap-2 rounded-md border bg-bg-surface px-3 py-2.5 text-body-sm font-medium transition",
              active
                ? "border-accent bg-accent-soft shadow-[inset_0_0_0_1px_var(--accent-primary)]"
                : "border-border hover:bg-bg-subtle",
            )}
          >
            <span aria-hidden className="h-3.5 w-3.5 shrink-0 rounded-[4px]" style={{ background: option.swatch }} />
            <span className="truncate">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
