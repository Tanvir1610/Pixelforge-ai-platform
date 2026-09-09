"use client";

import { cn } from "@/lib/utils";

export function Toggle({ checked, onChange, label, description, id }: {
  checked: boolean; onChange: (next: boolean) => void; label: string; description?: string; id: string;
}) {
  return (
    <div className="flex items-center justify-between gap-6 border-t border-border py-3 first:border-t-0">
      <span className="flex flex-col">
        <label htmlFor={id} className="text-body font-medium">{label}</label>
        {description && <span className="text-caption text-content-muted">{description}</span>}
      </span>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative h-5 w-9 shrink-0 rounded-full transition-colors",
          checked ? "bg-accent" : "bg-border-strong",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,.2)] transition-[left]",
            checked ? "left-[18px]" : "left-0.5",
          )}
        />
      </button>
    </div>
  );
}
