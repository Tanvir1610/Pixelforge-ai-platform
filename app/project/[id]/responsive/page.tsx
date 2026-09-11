import type { Metadata } from "next";
import { ResponsiveWorkspace } from "./responsive-workspace";
import { getProject, PROJECTS } from "@/lib/data";
import { getSession } from "@/lib/auth/session";
import { listProjects } from "@/lib/repositories/projects";
import { getDesignSummary, loadFramePreviews } from "@/lib/repositories/design-read";
import { workspaceCounts } from "@/lib/repositories/design-detail";
import { getLatestVersionFiles } from "@/lib/repositories/code";
import { toWorkspaceProject } from "@/lib/presenters/project";

/**
 * Dynamic: the breakpoints shown are the ones the project's own frames were
 * drawn at. Prerendered, it could only list the fixture's three.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: `${getProject(id).name} — Responsive` };
}

export default async function ResponsivePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();

  const isSampleId = PROJECTS.some((project) => project.id === id);
  const owned = session && !session.demo ? await listProjects(session, 20) : [];
  const real = isSampleId ? null : owned.find((project) => project.id === id || project.slug === id);

  if (!real || !session) {
    return <ResponsiveWorkspace project={getProject(id)} />;
  }

  const [summary, previews, counts, version] = await Promise.all([
    getDesignSummary(session, real.id),
    loadFramePreviews(session, real.id, 4),
    workspaceCounts(session, real.id),
    getLatestVersionFiles(real.id),
  ]);

  return (
    <ResponsiveWorkspace
      project={toWorkspaceProject(real, { ...counts, generatedFiles: version?.files.length ?? 0 })}
      frames={summary?.frames ?? []}
      previews={previews}
      live
    />
  );
}
