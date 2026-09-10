"use client";

import * as React from "react";
import { Bell, ChevronRight, Search } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function Topbar({ crumbs, actions, initials }: {
  crumbs: string[]; actions?: React.ReactNode; initials: string;
}) {
  return (
    <div className="sticky top-0 z-dropdown flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border bg-bg/90 px-5 backdrop-blur md:px-8">
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2 text-body-sm text-content-muted">
        {crumbs.map((crumb, index) => (
          <React.Fragment key={crumb}>
            {index > 0 && <ChevronRight aria-hidden className="h-3.5 w-3.5 shrink-0" />}
            <span className={index === crumbs.length - 1 ? "truncate font-medium text-content" : "truncate"}>
              {crumb}
            </span>
          </React.Fragment>
        ))}
      </nav>
      <div className="flex items-center gap-3">
        {actions}
        <Input
          className="hidden h-[34px] w-80 lg:flex"
          icon={<Search />}
          placeholder="Search projects and components"
          aria-label="Search"
          trailing={<kbd className="rounded-[4px] border border-border px-1.5 font-mono text-[11px]">⌘K</kbd>}
        />
        <Button variant="secondary" size="icon" aria-label="Notifications" className="hidden md:inline-flex">
          <Bell />
        </Button>
        <Avatar initials={initials} />
      </div>
    </div>
  );
}
