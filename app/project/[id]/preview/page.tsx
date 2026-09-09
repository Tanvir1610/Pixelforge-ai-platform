import type { Metadata } from "next";
import { PreviewWorkspace } from "./preview-workspace";
import { getProject, PROJECTS } from "@/lib/data";

export function generateStaticParams() {
  return PROJECTS.map((project) => ({ id: project.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: `${getProject(id).name} — Preview` };
}

export default async function PreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PreviewWorkspace project={getProject(id)} />;
}
