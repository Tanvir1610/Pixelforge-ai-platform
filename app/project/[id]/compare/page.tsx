import type { Metadata } from "next";
import { CompareWorkspace } from "./compare-workspace";
import { getProject, PROJECTS } from "@/lib/data";

export function generateStaticParams() {
  return PROJECTS.map((project) => ({ id: project.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: `${getProject(id).name} — Visual comparison` };
}

export default async function ComparePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CompareWorkspace project={getProject(id)} />;
}
