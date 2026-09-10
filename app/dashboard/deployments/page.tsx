import type { Metadata } from "next";
import { GitBranch } from "lucide-react";
import { AppShell, PageHeading } from "@/components/layout/app-shell";
import { DemoBanner } from "@/components/layout/demo-banner";
import { Badge } from "@/components/ui/badge";
import { requireSession } from "@/lib/auth/session";
import { listDeployments } from "@/lib/repositories/library";
import { listProjects } from "@/lib/repositories/projects";
import { DeployWorkspace } from "./deploy-workspace";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Deploy your website" };

export default async function DeploymentsPage() {
  const session = await requireSession();
  const [deployments, projects] = await Promise.all([
    listDeployments(session),
    listProjects(session, 1),
  ]);

  // The crumbs, the branch chip and the description were fixed strings naming
  // a project called "Northwind marketing" that no real account has.
  const project = projects[0] ?? null;
  const latest = deployments[0] ?? null;

  return (
    <AppShell
      crumbs={project ? [project.name, "Deploy"] : ["Deploy"]}
      actions={
        latest && latest.hash !== "—" ? (
          <Badge className="hidden md:inline-flex">
            <GitBranch aria-hidden className="h-3 w-3" />
            {latest.branch} · {latest.hash}
          </Badge>
        ) : undefined
      }
    >
      {session.demo && <DemoBanner />}
      <PageHeading
        title="Deploy your website"
        description={
          project
            ? `${project.name} · ${project.framework} · ${project.styling.replace("_", " ")}`
            : "Create a project and generate it before deploying."
        }
      />
      <DeployWorkspace deployments={deployments} />
    </AppShell>
  );
}
