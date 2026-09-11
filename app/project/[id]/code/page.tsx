import type { Metadata } from "next";
import { CodeWorkspace } from "./code-workspace";
import { getProject, PROJECTS } from "@/lib/data";
import { getSession } from "@/lib/auth/session";
import { listProjects } from "@/lib/repositories/projects";
import { getLatestVersionFiles, listVersions } from "@/lib/repositories/code";
import { workspaceCounts } from "@/lib/repositories/design-detail";
import { toWorkspaceProject } from "@/lib/presenters/project";

/**
 * Dynamic, because it shows the signed-in user's generated code. It was
 * prerendered from the sample project list, so it could only ever have shown
 * the fixture files.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: `${getProject(id).name} — Code` };
}

export default async function CodePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();

  const isSampleId = PROJECTS.some((project) => project.id === id);
  const owned = session && !session.demo ? await listProjects(session, 20) : [];
  const real = isSampleId ? null : owned.find((project) => project.id === id || project.slug === id);

  if (!real) {
    return <CodeWorkspace project={getProject(id)} />;
  }

  const [version, versions, counts] = await Promise.all([
    getLatestVersionFiles(real.id),
    listVersions(real.id, 20),
    workspaceCounts(session!, real.id),
  ]);

  return (
    <CodeWorkspace
      project={toWorkspaceProject(real, { ...counts, generatedFiles: version?.files.length ?? 0 })}
      version={version}
      versions={versions}
    />
  );
}
