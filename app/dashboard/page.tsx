import type { Metadata } from "next";
import Link from "next/link";
import { Code2, Folder, LayoutGrid, Rocket, Sparkles } from "lucide-react";
import { AppShell, PageHeading } from "@/components/layout/app-shell";
import { buttonClasses } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ProjectCard } from "@/components/sections/project-card";
import { DemoBanner } from "@/components/layout/demo-banner";
import { NewProjectTrigger } from "./new-project-trigger";
import { requireSession } from "@/lib/auth/session";
import { getProjectStats, listProjects } from "@/lib/repositories/projects";

// Session-dependent: must not be prerendered. Without this, a build made in
// demo mode would cache seeded data and serve it even once Supabase is configured.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  // requireSession redirects to /login when there is no session. RLS is still
  // the real boundary; this just gives a clean redirect instead of empty data.
  const session = await requireSession();
  const [projects, stats] = await Promise.all([listProjects(session), getProjectStats(session)]);

  const remainingCredits = Math.max(0, stats.aiCreditsLimit - stats.aiCreditsUsed);
  const creditsUsedPercent = stats.aiCreditsLimit
    ? Math.round((stats.aiCreditsUsed / stats.aiCreditsLimit) * 100)
    : 0;

  const cards = [
    { label: "Projects", value: String(stats.projects), delta: "in this workspace", icon: Folder },
    { label: "Generated websites", value: String(stats.generations), delta: "this month", icon: Code2 },
    { label: "Deployments", value: String(stats.deployments), delta: "this month", icon: Rocket },
    {
      label: "AI credits",
      value: String(remainingCredits),
      delta: `of ${stats.aiCreditsLimit.toLocaleString()} remaining`,
      icon: Sparkles,
      progress: 100 - creditsUsedPercent,
    },
  ];

  const firstName = session.user.full_name?.split(" ")[0] ?? "there";

  return (
    <AppShell crumbs={["Dashboard"]}>
      {session.demo && <DemoBanner />}
      <PageHeading
        title={`Good morning, ${firstName}.`}
        description="Turn your next design into a real product."
        actions={
          <>
            <Link href="/dashboard/import" className={buttonClasses("secondary")}>
              <LayoutGrid />
              Import design
            </Link>
            <NewProjectTrigger />
          </>
        }
      />

      <ul className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((stat) => {
          const Icon = stat.icon;
          return (
            <li key={stat.label} className="rounded-lg border border-border bg-bg-surface px-5 py-[18px]">
              <div className="flex items-center justify-between text-body-sm text-content-muted">
                {stat.label}
                <Icon aria-hidden className="h-4 w-4" />
              </div>
              <p className="mb-1 mt-2 font-display text-[30px] font-bold leading-none tracking-[-0.02em]">
                {stat.value}
              </p>
              <p className="text-caption text-content-muted">{stat.delta}</p>
              {stat.progress !== undefined && (
                <Progress value={stat.progress} className="mt-2.5" label="AI credits remaining" />
              )}
            </li>
          );
        })}
      </ul>

      <div className="mb-3.5 flex items-center justify-between">
        <h2 className="text-[16px] font-semibold">Recent projects</h2>
        <Link href="/dashboard/projects" className={buttonClasses("ghost", "sm")}>View all</Link>
      </div>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {projects.map((project) => (
          <ProjectCard key={project.id} project={project} />
        ))}
        <li className="grid min-h-[260px] place-items-center rounded-lg border border-dashed border-border bg-transparent p-6 text-center">
          <div>
            <span className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-lg bg-bg-subtle text-content">
              <LayoutGrid aria-hidden className="h-4 w-4" />
            </span>
            <b className="text-body">Start a new project</b>
            <p className="mx-auto mt-1 max-w-[24ch] text-caption text-content-muted">
              Import a Figma file or upload screens to begin.
            </p>
          </div>
        </li>
      </ul>
    </AppShell>
  );
}
