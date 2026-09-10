import type { Metadata } from "next";
import { CompareWorkspace } from "./compare-workspace";
import { getProject, PROJECTS } from "@/lib/data";
import { getSession } from "@/lib/auth/session";
import { listProjects } from "@/lib/repositories/projects";
import { getComparisons } from "@/lib/repositories/visual";

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

  const comparisons = real ? await getComparisons(real.id) : [];

  return (
    <CompareWorkspace
      project={real ? { ...getProject(id), id: real.id, name: real.name } : getProject(id)}
      comparisons={comparisons}
      live={Boolean(real)}
    />
  );
}
