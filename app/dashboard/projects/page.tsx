import type { Metadata } from "next";
import Link from "next/link";
import { Folder } from "lucide-react";
import { AppShell, PageHeading } from "@/components/layout/app-shell";
import { DemoBanner } from "@/components/layout/demo-banner";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonClasses } from "@/components/ui/button";
import { NewProjectTrigger } from "../new-project-trigger";
import { requireSession } from "@/lib/auth/session";
import { listProjects } from "@/lib/repositories/projects";
import { ProjectBrowser } from "./project-browser";

// Session-dependent: must not be prerendered. Without this, a build made in
// demo mode would cache seeded data and serve it even once Supabase is configured.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Projects" };

export default async function ProjectsPage() {
  const session = await requireSession();
  const projects = await listProjects(session, 60);

  return (
    <AppShell crumbs={["Projects"]}>
      {session.demo && <DemoBanner />}
      <PageHeading
        title="Projects"
        description={
          projects.length > 0
            ? `${projects.length} ${projects.length === 1 ? "project" : "projects"} in this workspace.`
            : "Every design you import becomes a project."
        }
        actions={<NewProjectTrigger />}
      />

      {projects.length === 0 ? (
        <EmptyState
          icon={<Folder />}
          title="No projects yet"
          body="A project holds one imported design, its generated code and everything derived from it."
          action={
            <Link href="/dashboard/import" className={buttonClasses("primary", "sm")}>
              Import a design
            </Link>
          }
        />
      ) : (
        <ProjectBrowser projects={projects} />
      )}
    </AppShell>
  );
}
