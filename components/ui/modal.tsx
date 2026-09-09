"use client";

import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

/**
 * Dialog with a focus trap, escape-to-close and a scroll lock. Deliberately
 * hand-rolled rather than pulled from a library so the markup matches the design.
 */
export function Modal({
  open, onClose, title, description, children, footer, className,
}: {
  open: boolean; onClose: () => void; title: string; description?: string;
  children: React.ReactNode; footer?: React.ReactNode; className?: string;
}) {
  const panelRef = React.useRef<HTMLDivElement>(null);
  const titleId = React.useId();

  React.useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    panelRef.current?.querySelector<HTMLElement>("input, button, [tabindex]")?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") return onClose();
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = overflow;
      previouslyFocused?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-modal grid place-items-center p-4">
      <div className="absolute inset-0 bg-bg-dark/40" onClick={onClose} aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          "relative flex max-h-[90vh] w-full max-w-[560px] animate-fade-up flex-col overflow-hidden rounded-xl bg-bg-surface shadow-lg",
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
          <div>
            <h2 id={titleId} className="text-h3">{title}</h2>
            {description && <p className="mt-0.5 text-body-sm text-content-muted">{description}</p>}
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close dialog">
            <X />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto scrollbar-thin">{children}</div>
        {footer && <div className="flex justify-end gap-2.5 border-t border-border bg-bg px-6 py-4">{footer}</div>}
      </div>
    </div>
  );
}
