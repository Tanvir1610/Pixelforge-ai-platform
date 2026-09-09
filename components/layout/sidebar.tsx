"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Boxes, ChevronDown, Folder, Home, Image as ImageIcon, LayoutGrid,
  MoreHorizontal, Rocket, Settings, Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Logo } from "./logo";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: Home },
  { href: "/dashboard/projects", label: "Projects", icon: Folder, count: 12 },
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
 */
export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="sticky top-0 hidden h-screen shrink-0 flex-col border-r border-border bg-bg-surface px-2 py-4 md:flex md:w-16 lg:w-60 lg:px-3">
      <div className="mb-3 flex items-center gap-2.5 rounded-md px-2 py-1.5 lg:hover:bg-bg-subtle">
        <Logo markOnly className="lg:[&>span:last-of-type]:hidden" />
        <span className="hidden min-w-0 flex-1 lg:block">
          <span className="block truncate text-body font-semibold">Basalt Studio</span>
          <span className="block truncate text-caption text-content-muted">Pro workspace</span>
        </span>
        <ChevronDown aria-hidden className="hidden h-4 w-4 text-content-muted lg:block" />
      </div>

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
              {item.count !== undefined && <Badge className="ml-auto hidden lg:inline-flex">{item.count}</Badge>}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto flex flex-col gap-3">
        <div className="hidden rounded-[10px] border border-border bg-bg p-3 lg:block">
          <div className="mb-2 flex items-center justify-between">
            <b className="text-body-sm">Pro plan</b>
            <span className="text-caption text-content-muted">1,240 / 2,000</span>
          </div>
          <Progress value={62} label="AI credits used" />
          <p className="mb-2.5 mt-2 text-caption text-content-muted">AI credits reset on 1 October.</p>
          <Button variant="dark" size="sm" className="w-full">Upgrade to Team</Button>
        </div>
        <div className="h-px bg-border" />
        <div className="flex items-center gap-2.5 p-2 max-lg:justify-center">
          <Avatar initials="TA" />
          <span className="hidden min-w-0 flex-1 lg:block">
            <span className="block truncate text-body-sm font-medium">Tanvir Ahmad</span>
            <span className="block truncate text-caption text-content-muted">tanvir@basalt.studio</span>
          </span>
          <MoreHorizontal aria-hidden className="hidden h-4 w-4 text-content-muted lg:block" />
        </div>
      </div>
    </aside>
  );
}
