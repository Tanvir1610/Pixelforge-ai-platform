"use client";

import * as React from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { Button, buttonClasses } from "@/components/ui/button";
import { Logo } from "./logo";

const LINKS = [
  { href: "/#how", label: "How it works" },
  { href: "/#features", label: "Product" },
  { href: "/pricing", label: "Pricing" },
  { href: "/#faq", label: "FAQ" },
];

export function MarketingNav() {
  const [open, setOpen] = React.useState(false);

  return (
    <header className="sticky top-0 z-sticky border-b border-border bg-bg/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-container items-center justify-between px-5 md:px-10 lg:px-20">
        <div className="flex items-center gap-8">
          <Logo />
          <nav aria-label="Main" className="hidden gap-7 text-body font-medium text-content-secondary lg:flex">
            {LINKS.map((link) => (
              <Link key={link.href} href={link.href} className="hover:text-content">{link.label}</Link>
            ))}
          </nav>
        </div>
        <div className="hidden items-center gap-3 md:flex">
          <Link href="/login" className={buttonClasses("ghost")}>Sign in</Link>
          <Link href="/signup" className={buttonClasses("primary")}>Start building</Link>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          aria-expanded={open}
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X /> : <Menu />}
        </Button>
      </div>
      {open && (
        <div className="border-t border-border bg-bg-surface px-5 py-4 md:hidden">
          <nav aria-label="Mobile" className="flex flex-col gap-1">
            {LINKS.map((link) => (
              <Link key={link.href} href={link.href} onClick={() => setOpen(false)} className="rounded-md px-2 py-2 text-body font-medium hover:bg-bg-subtle">
                {link.label}
              </Link>
            ))}
          </nav>
          <div className="mt-3 flex flex-col gap-2">
            <Link href="/login" className={buttonClasses("secondary")}>Sign in</Link>
            <Link href="/signup" className={buttonClasses("primary")}>Start building</Link>
          </div>
        </div>
      )}
    </header>
  );
}
