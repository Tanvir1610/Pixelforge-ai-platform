import type { Metadata } from "next";
import { CodeWorkspace } from "./code-workspace";
import { getProject, PROJECTS } from "@/lib/data";

export function generateStaticParams() {
  return PROJECTS.map((project) => ({ id: project.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: `${getProject(id).name} — Code` };
}

export default async function CodePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CodeWorkspace project={getProject(id)} />;
}
