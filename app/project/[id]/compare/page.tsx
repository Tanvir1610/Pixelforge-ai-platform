import type { Metadata } from "next";
import { CompareWorkspace } from "./compare-workspace";
import { getProject, PROJECTS } from "@/lib/data";
import { getSession } from "@/lib/auth/session";
import { listProjects } from "@/lib/repositories/projects";
import { getComparisons } from "@/lib/repositories/visual";
import { loadFramePreview } from "@/lib/repositories/design-read";
import { workspaceCounts } from "@/lib/repositories/design-detail";
import { getLatestVersionFiles } from "@/lib/repositories/code";
import { toWorkspaceProject } from "@/lib/presenters/project";

/**
 * Dynamic, because the score belongs to a project. Prerendered from the sample
 * list it could only ever have shown the fixture score, which it did — a 97%
 * match reported for projects that had never been built or screenshotted.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: `${getProject(id).name} — Visual comparison` };
}

export default async function ComparePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();

  const isSampleId = PROJECTS.some((project) => project.id === id);
  const owned = session && !session.demo ? await listProjects(session, 20) : [];
  const real = isSampleId ? null : owned.find((project) => project.id === id || project.slug === id);

  if (!real) {
    return <CompareWorkspace project={getProject(id)} />;
  }

  const [comparisons, frame, counts, version] = await Promise.all([
    getComparisons(real.id),
    loadFramePreview(session!, real.id),
    workspaceCounts(session!, real.id),
    getLatestVersionFiles(real.id),
  ]);

  return (
    <CompareWorkspace
      project={toWorkspaceProject(real, { ...counts, generatedFiles: version?.files.length ?? 0 })}
      comparisons={comparisons}
      frame={frame}
      live
    />
  );
}
