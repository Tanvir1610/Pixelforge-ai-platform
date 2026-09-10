import type { Metadata } from "next";
import { AnalysisWorkspace } from "./analysis-workspace";
import { requireSession } from "@/lib/auth/session";
import { listProjects } from "@/lib/repositories/projects";
import { getLatestRun } from "@/lib/repositories/generation";
import { loadFramePreview } from "@/lib/repositories/design-read";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Analysing your design" };

export default async function AnalysisPage({
  searchParams,
}: {
  searchParams: Promise<{ run?: string }>;
}) {
  const session = await requireSession();
  const { run: runParam } = await searchParams;

  const projects = await listProjects(session, 1);
  const project = projects[0] ?? null;

  // In demo mode there is no run to subscribe to, so the screen falls back to
  // the scripted sequence and says so.
  const [latest, frame] = project && !session.demo
    ? await Promise.all([getLatestRun(project.id), loadFramePreview(session, project.id)])
    : [null, null];
  const runId = runParam ?? latest?.run.id ?? null;

  return (
    <AnalysisWorkspace
      projectName={project?.name ?? "Untitled project"}
      runId={session.demo ? null : runId}
      initial={latest ?? undefined}
      demo={session.demo}
      frame={frame}
    />
  );
}
