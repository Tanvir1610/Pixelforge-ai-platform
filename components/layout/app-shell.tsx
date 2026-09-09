import * as React from "react";
import { Sidebar } from "./sidebar";
import { MobileTabBar } from "./mobile-tabbar";
import { Topbar } from "./topbar";

/** Dashboard chrome. Pages supply only their own content. */
export function AppShell({ crumbs, actions, children }: {
  crumbs: string[]; actions?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col pb-16 md:pb-0">
        <Topbar crumbs={crumbs} actions={actions} />
        <main className="flex-1 px-5 py-6 md:px-8 md:py-8">{children}</main>
      </div>
      <MobileTabBar />
    </div>
  );
}

export function PageHeading({ title, description, actions }: {
  title: string; description?: string; actions?: React.ReactNode;
}) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="font-display text-[26px] font-bold leading-tight tracking-[-0.02em]">{title}</h1>
        {description && <p className="mt-1 text-body text-content-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
