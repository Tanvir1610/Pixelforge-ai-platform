"use client";

import * as React from "react";
import { useActionState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Github, LayoutGrid } from "lucide-react";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card, CardBody, CardFooter, CardHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { OptionGroup } from "@/components/ui/option-group";
import { Toggle } from "@/components/ui/toggle";
import { Banner } from "@/components/ui/banner";
import {
  deleteProjectAction, updateProjectSettingsAction, type ProjectMutationState,
} from "@/lib/actions/projects";
import { cn } from "@/lib/utils";
import type { FrameworkKey, ProjectRow, StylingKey } from "@/lib/db/database.types";

/**
 * Project settings.
 *
 * Every control here was local state over a fixture. The name read "Northwind
 * marketing", the Figma source read "figma.com/design/8kQ2/Northwind", a
 * repository called "basalt-studio/northwind-marketing" was reported as
 * connected and pushing to main, "Save changes" showed a success banner without
 * writing anything, and the delete dialog asked the user to type the fixture's
 * name — which no real project has, so the confirm button could never enable.
 *
 * It now reads and writes the signed-in user's project. The sections with
 * nothing behind them are gone rather than disabled: a setting that is stored
 * nowhere and read by nothing is not a setting.
 */
const SECTIONS = ["General", "Framework", "Styling", "Repository", "Danger zone"];

const FRAMEWORKS: { value: FrameworkKey; label: string; swatch: string }[] = [
  { value: "nextjs", label: "Next.js", swatch: "#111111" },
  { value: "react", label: "React", swatch: "#61DAFB" },
  { value: "vue", label: "Vue", swatch: "#42B883" },
  { value: "html", label: "HTML/CSS", swatch: "#E44D26" },
];

const STYLING: { value: StylingKey; label: string; swatch: string }[] = [
  { value: "tailwind", label: "Tailwind CSS", swatch: "#38BDF8" },
  { value: "css_modules", label: "CSS Modules", swatch: "#8B5CF6" },
  { value: "vanilla_css", label: "Vanilla CSS", swatch: "#6B7280" },
];

const INITIAL: ProjectMutationState = {};

export function SettingsForm({
  project,
  figmaSource,
  github,
}: {
  project: ProjectRow;
  /** Where the design came from, or null if nothing has been imported. */
  figmaSource: string | null;
  /** The GitHub card, rendered on the server so it can read the connection. */
  github?: React.ReactNode;
}) {
  const router = useRouter();
  const [active, setActive] = React.useState("General");

  // Controlled so the hidden inputs the action reads stay in step with the
  // OptionGroup, which is a button group rather than a native radio set.
  const [framework, setFramework] = React.useState<FrameworkKey>(project.framework);
  const [styling, setStyling] = React.useState<StylingKey>(project.styling);
  const [typescript, setTypescript] = React.useState(project.typescript);
  const [responsive, setResponsive] = React.useState(project.responsive);

  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [deleteText, setDeleteText] = React.useState("");

  const [saveState, saveAction, saving] = useActionState(updateProjectSettingsAction, INITIAL);
  const [deleteState, deleteFormAction, deleting] = useActionState(deleteProjectAction, INITIAL);

  // A deleted project has no settings, so the screen has to leave.
  React.useEffect(() => {
    if (deleteState.ok) router.push("/dashboard/projects");
  }, [deleteState.ok, router]);

  return (
    <div className="grid gap-8 lg:grid-cols-[220px_1fr]">
      <nav aria-label="Settings sections" className="hidden lg:block">
        <ul className="sticky top-20 flex flex-col gap-0.5">
          {SECTIONS.filter((section) => section !== "Danger zone").map((section) => (
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
        {saveState.message && (
          <Banner tone={saveState.ok ? "success" : "error"}>{saveState.message}</Banner>
        )}
        {deleteState.message && !deleteState.ok && <Banner tone="error">{deleteState.message}</Banner>}

        <form action={saveAction} className="flex flex-col gap-5">
          <input type="hidden" name="projectId" value={project.id} />
          <input type="hidden" name="framework" value={framework} />
          <input type="hidden" name="styling" value={styling} />

          <Card>
            <CardHeader title="General" description="Name and description shown across the workspace." />
            <CardBody>
              <Field label="Project name" htmlFor="setting-name" error={saveState.errors?.name}>
                <Input id="setting-name" name="name" defaultValue={project.name} required maxLength={120} />
              </Field>
              <Field label="Description" htmlFor="setting-desc" error={saveState.errors?.description}>
                <textarea
                  id="setting-desc"
                  name="description"
                  rows={3}
                  maxLength={500}
                  defaultValue={project.description ?? ""}
                  placeholder="What this project is. Shown on the project card."
                  className="w-full resize-y rounded-md border border-border bg-bg-surface px-3 py-2.5 text-base shadow-sm outline-none focus:border-accent focus:shadow-[0_0_0_3px_rgba(99,102,241,.2)] sm:text-body"
                />
              </Field>
              <Field
                label="Design source"
                htmlFor="setting-figma"
                help={
                  figmaSource
                    ? "Re-importing pulls the latest version of this file."
                    : "Nothing has been imported into this project yet."
                }
              >
                <Input
                  id="setting-figma"
                  icon={<LayoutGrid />}
                  readOnly
                  value={figmaSource ?? "No design imported"}
                  className="font-mono text-caption"
                  trailing={
                    <Link href="/dashboard/import" className={buttonClasses("ghost", "xs")}>
                      {figmaSource ? "Re-import" : "Import"}
                    </Link>
                  }
                />
              </Field>
            </CardBody>
            <CardFooter>
              {/* "Discard" used to sit here and do nothing. A reload is the
                  discard, and the browser already has a button for it. */}
              <Button type="submit" variant="primary" loading={saving}>Save changes</Button>
            </CardFooter>
          </Card>

          <Card>
            <CardHeader
              title="Framework and styling"
              description="These are what the generator targets. Changing either affects the next generation."
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
                name="typescript"
                checked={typescript}
                onChange={setTypescript}
                label="TypeScript"
                description="Typed props on generated components."
              />
              <Toggle
                id="setting-responsive"
                name="responsive"
                checked={responsive}
                onChange={setResponsive}
                label="Responsive output"
                description="Generate breakpoint rules from the frames you imported."
              />
            </CardBody>
            <CardFooter>
              <Button type="submit" variant="primary" loading={saving}>Save changes</Button>
            </CardFooter>
          </Card>
        </form>

        {github}

        <Card className="border-[#FECACA]">
          <CardHeader
            className="border-[#FECACA]"
            title={<span className="text-error-text">Danger zone</span>}
            description="This action cannot be undone."
          />
          <CardBody>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <b className="block text-body">Delete project</b>
                <span className="text-caption text-content-muted">
                  Removes {project.name} from the workspace, with its design, versions and generated files.
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
        title={`Delete ${project.name}?`}
        description="This removes the project, its design and every generated version. It cannot be undone."
      >
        <form action={deleteFormAction}>
          <input type="hidden" name="projectId" value={project.id} />
          {/* The expected text is the project's own name. It used to be the
              fixture's, so the confirm button could never enable. */}
          <input type="hidden" name="expected" value={project.name} />
          <div className="p-6">
            <Field label="Type the project name to confirm" htmlFor="confirm-delete">
              <Input
                id="confirm-delete"
                name="confirm"
                value={deleteText}
                onChange={(event) => setDeleteText(event.target.value)}
                placeholder={project.name}
                autoComplete="off"
              />
            </Field>
          </div>
          <div className="flex justify-end gap-2 border-t border-border px-6 py-4">
            <Button type="button" variant="ghost" onClick={() => setConfirmDelete(false)}>Cancel</Button>
            <Button
              type="submit"
              variant="danger"
              loading={deleting}
              disabled={deleteText.trim() !== project.name}
            >
              Delete permanently
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
