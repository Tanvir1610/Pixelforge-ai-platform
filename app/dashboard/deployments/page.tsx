import type { Metadata } from "next";
import { AppShell, PageHeading } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { DeployWorkspace } from "./deploy-workspace";
import { GitBranch } from "lucide-react";

export const metadata: Metadata = { title: "Deploy your website" };

export default function DeploymentsPage() {
  return (
    <AppShell
      crumbs={["Northwind marketing", "Deploy"]}
      actions={
        <Badge className="hidden md:inline-flex">
          <GitBranch aria-hidden className="h-3 w-3" />
          main · a1b2c3d
        </Badge>
      }
    >
      <PageHeading title="Deploy your website" description="Northwind marketing · 6 pages · Next.js 15" />
      <DeployWorkspace />
    </AppShell>
  );
}
