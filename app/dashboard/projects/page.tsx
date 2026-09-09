import type { Metadata } from "next";
import { AppShell, PageHeading } from "@/components/layout/app-shell";
import { ProjectCard } from "@/components/sections/project-card";
import { DemoBanner } from "@/components/layout/demo-banner";
import { NewProjectTrigger } from "../new-project-trigger";
import { requireSession } from "@/lib/auth/session";
import { listProjects } from "@/lib/repositories/projects";

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
        description={`${projects.length} ${projects.length === 1 ? "project" : "projects"} in this workspace.`}
        actions={<NewProjectTrigger />}
      />
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {projects.map((project) => (
          <ProjectCard key={project.id} project={project} />
        ))}
      </ul>
    </AppShell>
  );
}
