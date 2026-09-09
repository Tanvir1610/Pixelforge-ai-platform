"use client";

import * as React from "react";
import { Github, LayoutGrid } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardFooter, CardHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { OptionGroup } from "@/components/ui/option-group";
import { Segmented } from "@/components/ui/segmented";
import { Toggle } from "@/components/ui/toggle";
import { Banner } from "@/components/ui/banner";
import { cn } from "@/lib/utils";
import type { Framework, Styling } from "@/types";

const SECTIONS = [
  "General", "Framework", "Styling", "Repository", "Environment variables",
  "Domains", "Deployment", "AI settings",
];

const FRAMEWORKS = [
  { value: "Next.js" as Framework, label: "Next.js", swatch: "#111111" },
  { value: "React" as Framework, label: "React", swatch: "#61DAFB" },
  { value: "Vue" as Framework, label: "Vue", swatch: "#42B883" },
  { value: "HTML/CSS" as Framework, label: "HTML/CSS", swatch: "#E44D26" },
];

const STYLING = [
  { value: "Tailwind CSS" as Styling, label: "Tailwind CSS", swatch: "#38BDF8" },
  { value: "CSS Modules" as Styling, label: "CSS Modules", swatch: "#8B5CF6" },
  { value: "Vanilla CSS" as Styling, label: "Vanilla CSS", swatch: "#6B7280" },
];

export function SettingsForm() {
  const [active, setActive] = React.useState("General");
  const [framework, setFramework] = React.useState<Framework>("Next.js");
  const [styling, setStyling] = React.useState<Styling>("Tailwind CSS");
  const [typescript, setTypescript] = React.useState(true);
  const [fidelity, setFidelity] = React.useState<"loose" | "balanced" | "strict">("balanced");
  const [autoSuggest, setAutoSuggest] = React.useState(true);
  const [reuse, setReuse] = React.useState(true);
  const [saved, setSaved] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [deleteText, setDeleteText] = React.useState("");

  return (
    <div className="grid gap-8 lg:grid-cols-[220px_1fr]">
      <nav aria-label="Settings sections" className="hidden lg:block">
        <ul className="sticky top-20 flex flex-col gap-0.5">
          {SECTIONS.map((section) => (
            <li key={section}>
              <button
                type="button"
                onClick={() => setActive(section)}
                aria-current={active === section ? "true" : undefined}
                className={cn(
                  "w-full rounded-[7px] px-2.5 py-2 text-left text-[13.5px] transition-colors",
                  active === section
                    ? "border border-border bg-bg-surface font-medium text-content"
                    : "text-content-secondary hover:text-content",
                )}
              >
                {section}
              </button>
            </li>
          ))}
          <li className="mt-2 border-t border-border pt-2">
            <button
              type="button"
              onClick={() => setActive("Danger zone")}
              className="w-full rounded-[7px] px-2.5 py-2 text-left text-[13.5px] text-error-text"
            >
              Danger zone
            </button>
          </li>
        </ul>
      </nav>

      <div className="flex max-w-[640px] flex-col gap-5">
        {saved && <Banner tone="success">Settings saved. They apply from the next generation.</Banner>}

        <Card>
          <CardHeader title="General" description="Name and description shown across the workspace." />
          <CardBody>
            <Field label="Project name" htmlFor="setting-name">
              <Input id="setting-name" defaultValue="Northwind marketing" />
            </Field>
            <Field label="Description" htmlFor="setting-desc">
              <textarea
                id="setting-desc"
                rows={3}
                defaultValue="Marketing site generated from the Northwind Figma file."
                className="w-full resize-y rounded-md border border-border bg-bg-surface px-3 py-2.5 text-body shadow-sm outline-none focus:border-accent focus:shadow-[0_0_0_3px_rgba(99,102,241,.2)]"
              />
            </Field>
            <Field
              label="Figma source"
              htmlFor="setting-figma"
              help="Re-import pulls the latest version of this file."
            >
              <Input
                id="setting-figma"
                icon={<LayoutGrid />}
                defaultValue="figma.com/design/8kQ2/Northwind"
                className="font-mono text-caption"
                trailing={<Button variant="ghost" size="xs">Change</Button>}
              />
            </Field>
          </CardBody>
          <CardFooter>
            <Button variant="ghost">Discard</Button>
            <Button variant="primary" onClick={() => setSaved(true)}>Save changes</Button>
          </CardFooter>
        </Card>

        <Card>
          <CardHeader
            title="Framework and styling"
            description="Changing either regenerates every page from the last analysis."
          />
          <CardBody>
            <div className="flex flex-col gap-1.5">
              <span className="text-body-sm font-medium">Framework</span>
              <OptionGroup label="Framework" options={FRAMEWORKS} value={framework} onChange={setFramework} columns={2} />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-body-sm font-medium">Styling</span>
              <OptionGroup label="Styling" options={STYLING} value={styling} onChange={setStyling} columns={3} />
            </div>
            <Toggle
              id="setting-ts"
              checked={typescript}
              onChange={setTypescript}
              label="TypeScript"
              description="Typed props on generated components."
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Repository" />
          <CardBody>
            <div className="flex flex-wrap items-center gap-3">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-bg-dark text-white">
                <Github aria-hidden className="h-3.5 w-3.5" />
              </span>
              <div className="min-w-[200px] flex-1">
                <b className="block text-body">basalt-studio/northwind-marketing</b>
                <span className="text-caption text-content-muted">
                  Connected · pushes to main on every approved generation
                </span>
              </div>
              <Button variant="secondary" size="sm">Disconnect</Button>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="AI settings"
            description="How much freedom the assistant has when it can't match the design exactly."
          />
          <CardBody>
            <Field
              label="Fidelity"
              htmlFor="fidelity"
              help="Strict keeps exact values from Figma even where they break at other widths."
            >
              <Segmented
                label="Fidelity"
                value={fidelity}
                onChange={setFidelity}
                className="w-fit"
                options={[
                  { value: "loose", label: "Loose" },
                  { value: "balanced", label: "Balanced" },
                  { value: "strict", label: "Strict pixel match" },
                ]}
              />
            </Field>
            <Toggle
              id="auto-suggest"
              checked={autoSuggest}
              onChange={setAutoSuggest}
              label="Suggest refinements automatically"
              description="Flag differences above 3% without being asked."
            />
            <Toggle
              id="reuse"
              checked={reuse}
              onChange={setReuse}
              label="Reuse workspace components"
              description="Import from your library instead of generating new files."
            />
          </CardBody>
        </Card>

        <Card className="border-[#FECACA]">
          <CardHeader
            className="border-[#FECACA]"
            title={<span className="text-error-text">Danger zone</span>}
            description="These actions cannot be undone."
          />
          <CardBody>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <b className="block text-body">Reset generated code</b>
                <span className="text-caption text-content-muted">
                  Deletes all files and regenerates from the last analysis.
                </span>
              </div>
              <Button variant="outlineDanger" size="sm">Reset code</Button>
            </div>
            <div className="h-px bg-border" />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <b className="block text-body">Delete project</b>
                <span className="text-caption text-content-muted">
                  Removes the project, its assets and every deployment.
                </span>
              </div>
              <Button variant="danger" size="sm" onClick={() => setConfirmDelete(true)}>Delete project</Button>
            </div>
          </CardBody>
        </Card>
      </div>

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete Northwind marketing?"
        description="This removes the project, its assets and every deployment. It cannot be undone."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>Cancel</Button>
            <Button variant="danger" disabled={deleteText !== "Northwind marketing"}>
              Delete permanently
            </Button>
          </>
        }
      >
        <div className="p-6">
          <Field label="Type the project name to confirm" htmlFor="confirm-delete">
            <Input
              id="confirm-delete"
              value={deleteText}
              onChange={(event) => setDeleteText(event.target.value)}
              placeholder="Northwind marketing"
            />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
