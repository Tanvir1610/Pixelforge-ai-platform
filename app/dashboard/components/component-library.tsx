"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs } from "@/components/ui/tabs";
import { EmptyState } from "@/components/ui/empty-state";
import { COMPONENT_LIBRARY } from "@/lib/data";
import { Boxes, Search } from "lucide-react";

type Tab = "mine" | "detected" | "reusable";

/** Live preview swatch per component, so the card shows the thing rather than a name. */
function Preview({ name }: { name: string }) {
  if (name === "Button")
    return (
      <div className="flex gap-2">
        <Button variant="primary" size="sm">Primary</Button>
        <Button variant="secondary" size="sm">Secondary</Button>
      </div>
    );
  if (name === "Badge")
    return (
      <div className="flex gap-1.5">
        <Badge tone="success" dot>Live</Badge>
        <Badge tone="warning">Review</Badge>
        <Badge>Draft</Badge>
      </div>
    );
  if (name === "Input") return <Input className="w-56" placeholder="you@company.com" aria-label="Preview input" />;
  if (name === "FeatureCard")
    return (
      <div className="w-52 rounded-lg border border-border bg-bg-surface p-4 shadow-sm">
        <span className="mb-2.5 grid h-7 w-7 place-items-center rounded-md bg-accent-soft text-accent">
          <Boxes aria-hidden className="h-3.5 w-3.5" />
        </span>
        <b className="text-body-sm">Fast by default</b>
        <p className="mt-1 text-caption text-content-muted">Static output, no runtime.</p>
      </div>
    );
  if (name === "Navbar")
    return (
      <div className="flex w-56 items-center justify-between text-body-sm">
        <span className="flex items-center gap-2 font-display font-bold">
          <span aria-hidden className="h-5 w-5 rounded-[5px] bg-bg-dark" />
          Northwind
        </span>
        <span className="text-caption text-content-muted">Product Docs</span>
      </div>
    );
  return (
    <div className="w-56 text-center">
      <p className="text-h3">Ship your ideas</p>
      <p className="mt-1 text-caption text-content-muted">Hero · display + body + CTA group</p>
    </div>
  );
}

export function ComponentLibrary() {
  const [tab, setTab] = React.useState<Tab>("mine");
  const [query, setQuery] = React.useState("");

  const results = COMPONENT_LIBRARY.filter((component) =>
    component.name.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <Tabs
          label="Component source"
          value={tab}
          onChange={setTab}
          className="border-b-0"
          tabs={[
            { value: "mine", label: "My components", count: 8 },
            { value: "detected", label: "Detected", count: 9 },
            { value: "reusable", label: "Reusable", count: 14 },
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
          <Button variant="primary" size="sm">
            <Plus />
            New component
          </Button>
        </div>
      </div>

      {results.length === 0 ? (
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
                <Preview name={component.name} />
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
