"use client";

import { cn } from "@/lib/utils";

/** Client-side because tab selection is interactive; CodeBlock stays a server component. */
export function EditorTabs({ files, active, onSelect }: {
  files: string[]; active: string; onSelect?: (file: string) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Open files"
      className="flex h-[42px] items-center gap-0.5 overflow-x-auto border-b border-border-dark bg-bg-dark-2 px-2 scrollbar-thin"
    >
      {files.map((file) => {
        const isActive = file === active;
        return (
          <button
            key={file}
            role="tab"
            type="button"
            aria-selected={isActive}
            onClick={onSelect ? () => onSelect(file) : undefined}
            className={cn(
              "flex h-[42px] shrink-0 items-center gap-2 border-b px-3 text-caption transition-colors",
              isActive
                ? "-mb-px border-accent bg-bg-dark text-white"
                : "border-transparent text-content-on-dark hover:text-white",
            )}
          >
            <span
              aria-hidden
              className={cn("h-2 w-2 rounded-[2px]", file.endsWith(".css") ? "bg-[#A78BFA]" : "bg-[#3B82F6]")}
            />
            {file}
          </button>
        );
      })}
    </div>
  );
}
