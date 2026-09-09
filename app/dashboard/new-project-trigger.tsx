"use client";

import * as React from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Banner } from "@/components/ui/banner";
import { createProjectAction, type CreateProjectState } from "@/lib/actions/projects";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Field, Input } from "@/components/ui/input";
import { OptionGroup } from "@/components/ui/option-group";
import { Toggle } from "@/components/ui/toggle";
import type { FrameworkKey as Framework, HostProviderKey as HostProvider, StylingKey as Styling } from "@/lib/db/database.types";

const FRAMEWORKS = [
  { value: "nextjs" as Framework, label: "Next.js", swatch: "#111111" },
  { value: "react" as Framework, label: "React", swatch: "#61DAFB" },
  { value: "vue" as Framework, label: "Vue", swatch: "#42B883" },
  { value: "html" as Framework, label: "HTML/CSS", swatch: "#E44D26" },
];

const STYLING = [
  { value: "tailwind" as Styling, label: "Tailwind CSS", swatch: "#38BDF8" },
  { value: "css_modules" as Styling, label: "CSS Modules", swatch: "#8B5CF6" },
  { value: "vanilla_css" as Styling, label: "Vanilla CSS", swatch: "#6B7280" },
];

const HOSTS = [
  { value: "none" as HostProvider, label: "None", swatch: "#D1D5DB" },
  { value: "vercel" as HostProvider, label: "Vercel", swatch: "#111111" },
  { value: "netlify" as HostProvider, label: "Netlify", swatch: "#0E1E25" },
];

/** Owns the create-project dialog so the dashboard page can stay a server component. */
const INITIAL: CreateProjectState = {};

export function NewProjectTrigger() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [framework, setFramework] = React.useState<Framework>("nextjs");
  const [styling, setStyling] = React.useState<Styling>("tailwind");
  const [host, setHost] = React.useState<HostProvider>("vercel");
  const [typescript, setTypescript] = React.useState(true);
  const [responsive, setResponsive] = React.useState(true);
  const [state, formAction, pending] = useActionState(createProjectAction, INITIAL);

  // On success the action returns the new slug; move the user to the import
  // step. Navigation is an external effect, but closing the dialog is derived
  // state — deriving it avoids a cascading render.
  const isOpen = open && !state.slug;

  React.useEffect(() => {
    if (state.slug) router.push("/dashboard/import");
  }, [state.slug, router]);

  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        <Plus />
        New project
      </Button>
      <Modal
        open={isOpen}
        onClose={() => setOpen(false)}
        title="New project"
        description="You can change any of this later in project settings."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              type="submit"
              form="new-project-form"
              variant="primary"
              loading={pending}
              disabled={!name.trim()}
            >
              Create project
            </Button>
          </>
        }
      >
        <form id="new-project-form" action={formAction} className="flex flex-col gap-5 p-6">
          {state.message && <Banner tone="error">{state.message}</Banner>}

          {/* The pickers are custom controls, so their values ride along as hidden inputs. */}
          <input type="hidden" name="framework" value={framework} />
          <input type="hidden" name="styling" value={styling} />
          <input type="hidden" name="hostProvider" value={host} />
          {typescript && <input type="hidden" name="typescript" value="on" />}
          {responsive && <input type="hidden" name="responsive" value="on" />}

          <Field
            label="Project name"
            htmlFor="project-name"
            help="Used for the repository name and preview URL."
            error={state.errors?.name}
          >
            <Input
              id="project-name"
              name="name"
              value={name}
              placeholder="Northwind marketing"
              invalid={Boolean(state.errors?.name)}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <div className="flex flex-col gap-1.5">
            <span className="text-body-sm font-medium">Framework</span>
            <OptionGroup label="Framework" options={FRAMEWORKS} value={framework} onChange={setFramework} columns={2} />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-body-sm font-medium">Styling</span>
            <OptionGroup label="Styling" options={STYLING} value={styling} onChange={setStyling} columns={3} />
          </div>
          <div>
            <Toggle
              id="typescript"
              checked={typescript}
              onChange={setTypescript}
              label="TypeScript"
              description="Typed props on every generated component."
            />
            <Toggle
              id="responsive"
              checked={responsive}
              onChange={setResponsive}
              label="Responsive breakpoints"
              description="Derive tablet and mobile layouts from Figma constraints."
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-body-sm font-medium">Deployment</span>
            <OptionGroup label="Deployment" options={HOSTS} value={host} onChange={setHost} columns={3} />
            <p className="text-caption text-content-muted">
              Connect the host now and every generation gets a preview URL.
            </p>
          </div>
        </form>
      </Modal>
    </>
  );
}
