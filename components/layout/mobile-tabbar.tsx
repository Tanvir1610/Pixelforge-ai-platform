"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Folder, Home, LayoutGrid, Sparkles, User } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/dashboard", label: "Home", icon: Home },
  { href: "/dashboard/projects", label: "Projects", icon: Folder },
  { href: "/dashboard/import", label: "Import", icon: LayoutGrid },
  { href: "/dashboard/analysis", label: "AI", icon: Sparkles },
  { href: "/dashboard/settings", label: "You", icon: User },
];

export function MobileTabBar() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-sticky grid h-16 grid-cols-5 border-t border-border bg-bg-surface md:hidden"
    >
      {TABS.map((tab) => {
        const active = pathname === tab.href;
        const Icon = tab.icon;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex flex-col items-center justify-center gap-1 text-[10px]",
              active ? "text-accent" : "text-content-muted",
            )}
          >
            <Icon aria-hidden className="h-5 w-5" />
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
