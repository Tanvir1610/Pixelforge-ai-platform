"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Boxes, ChevronDown, Folder, Home, Image as ImageIcon, LayoutGrid,
  LogOut, Rocket, Settings, Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { ShellData } from "@/lib/presenters/shell";
import { Logo } from "./logo";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: Home },
  { href: "/dashboard/projects", label: "Projects", icon: Folder, showCount: true },
  { href: "/dashboard/import", label: "Import design", icon: LayoutGrid },
  { href: "/dashboard/understanding", label: "Templates", icon: LayoutGrid },
  { href: "/dashboard/components", label: "Components", icon: Boxes },
  { href: "/dashboard/assets", label: "Assets", icon: ImageIcon },
  { href: "/dashboard/analysis", label: "Generations", icon: Sparkles },
  { href: "/dashboard/deployments", label: "Deployments", icon: Rocket },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

/**
 * Collapses to an icon rail at tablet width and is replaced entirely by the
 * mobile tab bar below 768px, per the responsive frames in the design.
 *
 * Every value here comes from the session. It used to be hardcoded — a fixed
 * workspace name, a fixed person, a 12-project badge and a 1,240/2,000 credit
 * bar — so a real account saw someone else's details next to its own figures.
 */
export function Sidebar({ shell }: { shell: ShellData }) {
  const pathname = usePathname();

  return (
    <aside className="sticky top-0 hidden h-screen shrink-0 flex-col border-r border-border bg-bg-surface px-2 py-4 md:flex md:w-16 lg:w-60 lg:px-3">
      <Link
        href="/dashboard/settings"
        className="mb-3 flex items-center gap-2.5 rounded-md px-2 py-1.5 lg:hover:bg-bg-subtle"
      >
        <Logo markOnly className="lg:[&>span:last-of-type]:hidden" />
        <span className="hidden min-w-0 flex-1 lg:block">
          <span className="block truncate text-body font-semibold">{shell.organizationName}</span>
          <span className="block truncate text-caption text-content-muted">{shell.planLabel}</span>
        </span>
        <ChevronDown aria-hidden className="hidden h-4 w-4 text-content-muted lg:block" />
      </Link>

      <nav aria-label="Workspace" className="flex flex-col gap-0.5">
        {NAV.map((item) => {
          const active = pathname === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              title={item.label}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-body font-medium transition-colors",
                "max-lg:justify-center",
                active
                  ? "bg-accent-soft text-[#3730A3] [&_svg]:text-accent"
                  : "text-content-secondary hover:bg-bg-subtle hover:text-content [&_svg]:text-content-muted",
              )}
            >
              <Icon aria-hidden className="h-4 w-4 shrink-0" />
              <span className="hidden lg:inline">{item.label}</span>
              {/* Hidden at zero rather than showing a "0" badge, which reads as
                  a notification that something is wrong. */}
              {item.showCount && shell.projectCount > 0 && (
                <Badge className="ml-auto hidden lg:inline-flex">{shell.projectCount}</Badge>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto flex flex-col gap-3">
        <div className="hidden rounded-[10px] border border-border bg-bg p-3 lg:block">
          <div className="mb-2 flex items-center justify-between gap-2">
            <b className="truncate text-body-sm">{shell.planLabel}</b>
            <span className="shrink-0 text-caption text-content-muted">
              {shell.creditsUsed.toLocaleString()} / {shell.creditsLimit.toLocaleString()}
            </span>
          </div>
          <Progress value={shell.creditsPercentUsed} label="AI credits used" />
          <p className="mb-2.5 mt-2 text-caption text-content-muted">
            AI credits reset on {shell.creditsResetLabel}.
          </p>
          {!shell.planIsPaid && (
            <Link href="/pricing" className="block">
              <Button variant="dark" size="sm" className="w-full">Upgrade</Button>
            </Link>
          )}
        </div>

        <div className="h-px bg-border" />

        <div className="flex items-center gap-2.5 p-2 max-lg:justify-center">
          <Avatar initials={shell.initials} />
          <span className="hidden min-w-0 flex-1 lg:block">
            <span className="block truncate text-body-sm font-medium">{shell.userName}</span>
            <span className="block truncate text-caption text-content-muted">{shell.userEmail}</span>
          </span>
          {/* A real form, not a decorative "…". The sign-out route existed and
              nothing had ever called it. */}
          <form action="/auth/signout" method="post" className="hidden lg:block">
            <button
              type="submit"
              aria-label="Sign out"
              title="Sign out"
              className="grid h-7 w-7 place-items-center rounded-sm text-content-muted transition-colors hover:bg-bg-subtle hover:text-content"
            >
              <LogOut aria-hidden className="h-4 w-4" />
            </button>
          </form>
        </div>
      </div>
    </aside>
  );
}
