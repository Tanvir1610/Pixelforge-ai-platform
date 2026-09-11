import type { Metadata } from "next";
import { PreviewWorkspace } from "./preview-workspace";
import { getProject, PROJECTS } from "@/lib/data";
import { getSession } from "@/lib/auth/session";
import { listProjects } from "@/lib/repositories/projects";
import { loadAssistantHistory } from "@/lib/actions/assistant";
import { getLatestVersionFiles } from "@/lib/repositories/code";
import { loadFramePreview } from "@/lib/repositories/design-read";
import { getLatestRun } from "@/lib/repositories/generation";
import { getComparisons } from "@/lib/repositories/visual";
import { toWorkspaceProject } from "@/lib/presenters/project";
import { initialsFrom } from "@/lib/presenters/shell";
import { workspaceCounts } from "@/lib/repositories/design-detail";

/**
 * Dynamic, because the assistant beside the preview answers about the signed-in
 * user's own project. It used to be prerendered from the sample project list,
 * so the panel could only ever have been scripted.
 *
 * The preview draws the imported frame. Showing the *generated* site needs it
 * built and served, which this deployment has no sandbox for.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: `${getProject(id).name} — Preview` };
}

export default async function PreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();

  // A sample id means the sample project; anything else is looked up against
  // the user's own, so the assistant knows which design it is talking about.
  const isSampleId = PROJECTS.some((project) => project.id === id);
  const owned = session && !session.demo ? await listProjects(session, 20) : [];
  const real = isSampleId ? null : owned.find((project) => project.id === id || project.slug === id);

  if (!real) {
    return <PreviewWorkspace project={getProject(id)} />;
  }

  const [history, version, frame, run, counts, comparisons] = await Promise.all([
    loadAssistantHistory(),
    getLatestVersionFiles(real.id),
    loadFramePreview(session!, real.id),
    getLatestRun(real.id),
    workspaceCounts(session!, real.id),
    getComparisons(real.id),
  ]);
  const comparison = comparisons[0] ?? null;

  return (
    <PreviewWorkspace
      // The project's own framework, styling, status and counts — not the
      // fixture's, which is what every field but id and name used to be.
      project={toWorkspaceProject(real, { ...counts, generatedFiles: version?.files.length ?? 0 })}
      live
      assistantLive
      assistantHistory={history}
      userInitials={initialsFrom(session!.user.full_name, session!.user.email)}
      files={version?.files.map((file) => file.path) ?? []}
      writtenFiles={version?.files.map((file) => ({
        path: file.path,
        bytes: file.bytes,
        changeKind: file.changeKind,
      }))}
      frame={frame}
      generatedFileCount={version?.files.length ?? 0}
      runId={run?.run.id ?? null}
      initialRun={run ?? undefined}
      // Only a real comparison produces a score. There was a hardcoded 97.
      matchScore={comparison ? Math.round(comparison.similarity) : null}
    />
  );
}
