"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronLeft, Github, Rocket } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Project } from "@/types";

const MODES = [
  { segment: "preview", label: "Preview" },
  { segment: "code", label: "Code" },
  { segment: "compare", label: "Design" },
  { segment: "responsive", label: "Responsive" },
];

/** Top bar shared by every workspace mode, so switching never moves the chrome. */
export function WorkspaceShell({ project, status, children }: {
  project: Project; status?: React.ReactNode; children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <header className="flex h-[52px] shrink-0 items-center justify-between gap-4 border-b border-border bg-bg-surface px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <Link href="/dashboard" aria-label="Back to dashboard" className="text-content-muted hover:text-content">
            <ChevronLeft className="h-4 w-4" />
          </Link>
          <span className="truncate text-body font-semibold">{project.name}</span>
          {status}
        </div>

        <nav aria-label="Workspace mode" className="hidden gap-0.5 rounded-md border border-border bg-bg-subtle p-[3px] md:flex">
          {MODES.map((mode) => {
            const href = `/project/${project.id}/${mode.segment}`;
            const active = pathname === href;
            return (
              <Link
                key={mode.segment}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-sm px-3.5 py-1.5 text-body-sm font-medium transition-colors",
                  active ? "bg-bg-surface text-content shadow-sm" : "text-content-muted hover:text-content",
                )}
              >
                {mode.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" className="hidden sm:inline-flex">
            <Github />
            Push
          </Button>
          <Link href="/dashboard/deployments" className={buttonClasses("dark", "sm")}>
            <Rocket />
            Deploy
          </Link>
        </div>
      </header>

      <nav aria-label="Workspace mode" className="flex shrink-0 gap-0.5 overflow-x-auto border-b border-border bg-bg-surface px-3 py-2 md:hidden">
        {MODES.map((mode) => {
          const href = `/project/${project.id}/${mode.segment}`;
          const active = pathname === href;
          return (
            <Link
              key={mode.segment}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "shrink-0 rounded-sm px-3 py-1.5 text-body-sm font-medium",
                active ? "bg-bg-subtle text-content" : "text-content-muted",
              )}
            >
              {mode.label}
            </Link>
          );
        })}
      </nav>

      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

export { MODES };
