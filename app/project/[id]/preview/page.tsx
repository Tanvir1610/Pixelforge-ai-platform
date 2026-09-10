import type { Metadata } from "next";
import { PreviewWorkspace } from "./preview-workspace";
import { getProject, PROJECTS } from "@/lib/data";
import { getSession } from "@/lib/auth/session";
import { listProjects } from "@/lib/repositories/projects";
import { loadAssistantHistory } from "@/lib/actions/assistant";

/**
 * Dynamic, because the assistant beside the preview answers about the signed-in
 * user's own project. It used to be prerendered from the sample project list,
 * so the panel could only ever have been scripted.
 *
 * The preview itself is still sample output: showing real generated code needs
 * a generation run to have produced some, which is the codegen pipeline rather
 * than this screen.
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

  const live = Boolean(real);
  const history = live ? await loadAssistantHistory() : undefined;

  return (
    <PreviewWorkspace
      project={real ? { ...getProject(id), id: real.id, name: real.name } : getProject(id)}
      assistantLive={live}
      assistantHistory={history}
    />
  );
}
