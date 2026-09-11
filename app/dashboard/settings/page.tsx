import type { Metadata } from "next";
import { AppShell, PageHeading } from "@/components/layout/app-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonClasses } from "@/components/ui/button";
import Link from "next/link";
import { FolderPlus } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { listProjects } from "@/lib/repositories/projects";
import { createServiceClient } from "@/lib/supabase/server";
import { SettingsForm } from "./settings-form";

/**
 * Dynamic: these are one project's settings, and the project is the signed-in
 * user's. The page was static, breadcrumbed "Northwind marketing", and rendered
 * a form whose every value was a fixture — including a GitHub repository it
 * claimed was connected and a delete confirmation that asked the user to type
 * the fixture's name.
 */
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Project settings" };

/** The Figma file this project was imported from, when it was. */
async function figmaSource(projectId: string): Promise<string | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("figma_files")
    .select("figma_file_key, name")
    .eq("project_id", projectId)
    .limit(1)
    .maybeSingle<{ figma_file_key: string; name: string }>();

  return data ? `figma.com/design/${data.figma_file_key}` : null;
}

export default async function SettingsPage() {
  const session = await requireSession();
  const projects = session.demo ? [] : await listProjects(session, 1);
  const project = projects[0] ?? null;

  if (!project) {
    return (
      <AppShell crumbs={["Projects", "Settings"]}>
        <PageHeading title="Project settings" />
        <EmptyState
          icon={<FolderPlus />}
          title="No project to configure yet"
          body="Settings belong to a project — its framework, styling and design source. Create one and this fills in."
          action={
            <Link href="/dashboard/import" className={buttonClasses("primary", "sm")}>
              Import a design
            </Link>
          }
        />
      </AppShell>
    );
  }

  const source = await figmaSource(project.id);

  return (
    <AppShell crumbs={[project.name, "Settings"]}>
      <PageHeading title="Project settings" description="Changes apply to the next generation unless noted." />
      <SettingsForm project={project} figmaSource={source} />
    </AppShell>
  );
}
