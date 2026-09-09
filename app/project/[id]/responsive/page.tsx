import type { Metadata } from "next";
import { ResponsiveWorkspace } from "./responsive-workspace";
import { getProject, PROJECTS } from "@/lib/data";

export function generateStaticParams() {
  return PROJECTS.map((project) => ({ id: project.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: `${getProject(id).name} — Responsive testing` };
}

export default async function ResponsivePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ResponsiveWorkspace project={getProject(id)} />;
}
