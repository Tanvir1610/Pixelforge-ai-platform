"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

const SECTIONS = [
  { id: "layout", label: "Layout structure" },
  { id: "components", label: "Components detected" },
  { id: "typography", label: "Typography" },
  { id: "colours", label: "Colours" },
  { id: "spacing", label: "Spacing" },
  { id: "assets", label: "Assets" },
  { id: "interactions", label: "Interactions" },
  { id: "responsive", label: "Responsive rules" },
];

/** Scroll-spy table of contents, so the reader always knows where they are. */
export function UnderstandingNav() {
  const [active, setActive] = React.useState(SECTIONS[0].id);

  React.useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting);
        if (visible.length > 0) setActive(visible[0].target.id);
      },
      { rootMargin: "-80px 0px -70% 0px" },
    );
    SECTIONS.forEach((section) => {
      const element = document.getElementById(section.id);
      if (element) observer.observe(element);
    });
    return () => observer.disconnect();
  }, []);

  return (
    <nav aria-label="Analysis sections" className="hidden lg:block">
      <ul className="sticky top-20 flex flex-col gap-0.5">
        {SECTIONS.map((section) => (
          <li key={section.id}>
            <a
              href={`#${section.id}`}
              aria-current={active === section.id ? "true" : undefined}
              className={cn(
                "block rounded-sm px-2.5 py-1.5 text-body-sm transition-colors",
                active === section.id
                  ? "border border-border bg-bg-surface font-medium text-content"
                  : "text-content-secondary hover:text-content",
              )}
            >
              {section.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
