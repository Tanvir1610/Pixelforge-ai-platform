"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { Button, buttonClasses } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs } from "@/components/ui/tabs";
import { EmptyState } from "@/components/ui/empty-state";
import type { ComponentEntry } from "@/types";
import { Boxes, Search } from "lucide-react";

type Tab = "detected" | "reusable";

/**
 * The card's preview tile.
 *
 * This used to switch on the component's *name* and render one of six hand-drawn
 * previews — a Button, a Badge, an Input, a FeatureCard, a Navbar reading
 * "Northwind", and a fallback reading "Ship your ideas". Those names are the
 * sample project's, so a real component called "ProductTile" or "PriceRow" fell
 * through to the fallback and advertised somebody else's tagline; a real
 * component that happened to be called "Navbar" was drawn as Northwind's.
 *
 * A detected component has a name, a variant set and an instance count, and no
 * geometry of its own — instances do. So the tile shows what is actually known.
 */
function Preview({ component }: { component: ComponentEntry }) {
  const initials = component.name
    .replace(/[^A-Za-z0-9 ]/g, " ")
    .split(/\s+|(?=[A-Z])/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join("");

  return (
    <div className="flex flex-col items-center gap-2 px-4 text-center">
      <span
        aria-hidden
        className="grid h-11 w-11 place-items-center rounded-lg bg-bg-surface font-display text-body font-bold text-content-secondary shadow-sm"
      >
        {initials || "?"}
      </span>
      <span className="text-caption text-content-muted">
        {component.variants.length > 0
          ? `${component.variants.length} ${component.variants.length === 1 ? "variant" : "variants"}`
          : "No variants"}
        {" · "}
        {component.usage} {component.usage === 1 ? "instance" : "instances"}
      </span>
    </div>
  );
}

export function ComponentLibrary({ components }: { components: ComponentEntry[] }) {
  const [tab, setTab] = React.useState<Tab>("detected");
  const [query, setQuery] = React.useState("");

  /**
   * The tabs used to filter nothing: all three showed the same list, and two of
   * the three counts were the same number. Everything here is detected from a
   * design — there is no authoring flow — so "reusable" (used more than once)
   * is the only distinction the data actually supports.
   */
  const results = components
    .filter((component) => (tab === "reusable" ? component.usage > 1 : true))
    .filter((component) => component.name.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <Tabs
          label="Component source"
          value={tab}
          onChange={setTab}
          className="border-b-0"
          tabs={[
            { value: "detected", label: "Detected", count: components.length },
            { value: "reusable", label: "Used more than once", count: components.filter((c) => c.usage > 1).length },
          ]}
        />
        <div className="flex items-center gap-2">
          <Input
            className="w-56"
            icon={<Search />}
            aria-label="Search components"
            placeholder="Search components"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {/* "New component" had no handler. Components are detected during
              import, so that is where one comes from. */}
          <Link href="/dashboard/import" className={buttonClasses("secondary", "sm")}>
            <Plus />
            Import a design
          </Link>
        </div>
      </div>

      {components.length === 0 ? (
        <EmptyState
          icon={<Boxes />}
          title="No components yet"
          body="Components are detected when you import a Figma file. Import a design and they will appear here."
          action={
            <Link href="/dashboard/import" className={buttonClasses("primary", "sm")}>
              Import a design
            </Link>
          }
        />
      ) : results.length === 0 ? (
        <EmptyState
          icon={<Search />}
          title={`No results for "${query}"`}
          body="Try a shorter term, or search all workspaces instead of this project."
          action={<Button variant="ghost" size="sm" onClick={() => setQuery("")}>Clear search</Button>}
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {results.map((component) => (
            <li key={component.id} className="overflow-hidden rounded-lg border border-border bg-bg-surface">
              <div
                className="grid h-[140px] place-items-center border-b border-border bg-bg-subtle"
                style={{ backgroundImage: "radial-gradient(#DDDFE4 1px, transparent 1px)", backgroundSize: "12px 12px" }}
              >
                <Preview component={component} />
              </div>
              <div className="px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-body font-semibold">{component.name}</h3>
                  <span className="text-caption text-content-muted">Used {component.usage}×</span>
                </div>
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {component.variants.map((variant) => (
                    <li key={variant} className="rounded-[5px] border border-border bg-bg px-1.5 py-0.5 text-[11px] text-content-secondary">
                      {variant}
                    </li>
                  ))}
                </ul>
                {component.states && (
                  <ul className="mt-1.5 flex flex-wrap gap-1.5">
                    {component.states.map((state) => (
                      <li key={state} className="rounded-[5px] border border-border bg-bg px-1.5 py-0.5 text-[11px] text-content-secondary">
                        {state}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
