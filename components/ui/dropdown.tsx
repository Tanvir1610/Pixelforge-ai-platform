"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface MenuItem {
  label: string;
  icon?: React.ReactNode;
  shortcut?: string;
  destructive?: boolean;
  onSelect?: () => void;
}

export function Dropdown({ trigger, items, align = "end", label }: {
  trigger: React.ReactNode; items: (MenuItem | "separator")[]; align?: "start" | "end"; label: string;
}) {
  const [open, setOpen] = React.useState(false);
  const root = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <span onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open}>
        {trigger}
      </span>
      {open && (
        <div
          role="menu"
          aria-label={label}
          className={cn(
            "absolute top-full z-dropdown mt-1.5 w-56 animate-fade-up rounded-[10px] border border-border bg-bg-surface p-1.5 shadow-lg",
            align === "end" ? "right-0" : "left-0",
          )}
        >
          {items.map((item, index) =>
            item === "separator" ? (
              <div key={`sep-${index}`} role="separator" className="my-1.5 h-px bg-border" />
            ) : (
              <button
                key={item.label}
                role="menuitem"
                type="button"
                onClick={() => {
                  item.onSelect?.();
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-left text-body-sm hover:bg-bg-subtle",
                  "[&_svg]:h-4 [&_svg]:w-4 [&_svg]:text-content-muted",
                  item.destructive && "text-error-text [&_svg]:text-error-text",
                )}
              >
                {item.icon}
                {item.label}
                {item.shortcut && <kbd className="ml-auto font-mono text-[11px] text-content-muted">{item.shortcut}</kbd>}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
