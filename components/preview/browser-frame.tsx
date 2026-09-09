import * as React from "react";
import { Lock, RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";

/** Chrome-like shell that makes the preview read as a real site, not an embed. */
export function BrowserFrame({ url, children, className, compact = false }: {
  url: string; children: React.ReactNode; className?: string; compact?: boolean;
}) {
  return (
    <div className={cn("overflow-hidden rounded-lg border border-border bg-bg-surface shadow-lg", className)}>
      <div className={cn("flex items-center gap-2.5 border-b border-border bg-bg px-3", compact ? "h-8" : "h-[38px]")}>
        {!compact && (
          <span aria-hidden className="flex gap-1.5">
            {[0, 1, 2].map((i) => (
              <i key={i} className="h-2.5 w-2.5 rounded-full bg-border-strong" />
            ))}
          </span>
        )}
        <span className="flex h-6 flex-1 items-center gap-1.5 truncate rounded-sm border border-border bg-bg-surface px-2.5 font-mono text-[11px] text-content-muted">
          <Lock aria-hidden className="h-3 w-3 text-success" />
          {url}
        </span>
        {!compact && <RotateCw aria-hidden className="h-3.5 w-3.5 text-content-muted" />}
      </div>
      {children}
    </div>
  );
}
