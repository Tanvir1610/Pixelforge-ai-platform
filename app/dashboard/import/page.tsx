import type { Metadata } from "next";
import { AppShell } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { requireSession } from "@/lib/auth/session";
import { listProjects } from "@/lib/repositories/projects";
import { hasFigmaConnection } from "@/lib/repositories/figma-connection";
import { ImportOptions } from "./import-options";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Import your Figma design" };

export default async function ImportPage({
  searchParams,
}: {
  searchParams: Promise<{ connect_error?: string; connected?: string }>;
}) {
  const { connect_error: connectError, connected } = await searchParams;
  const session = await requireSession();
  const [projects, figmaConnected] = await Promise.all([
    listProjects(session, 1),
    hasFigmaConnection(session),
  ]);

  const target = projects[0] ?? null;

  return (
    <AppShell
      crumbs={[target?.name ?? "Projects", "Import design"]}
      actions={<Badge className="hidden sm:inline-flex">Step 1 of 3</Badge>}
    >
      <div className="mx-auto max-w-[760px] pt-2">
        <h1 className="text-center font-display text-[26px] font-bold tracking-[-0.02em] md:text-[30px]">
          Import your Figma design
        </h1>
        <p className="mx-auto mb-9 mt-2 max-w-[52ch] text-center text-body text-content-muted">
          Connect your account for the most accurate result — we read layers, variables and constraints, not just
          pixels.
        </p>
        <ImportOptions
          projectId={session.demo ? null : (target?.id ?? null)}
          figmaConnected={figmaConnected}
          demo={session.demo}
          connectError={connectError}
          justConnected={connected === "figma"}
        />
      </div>
    </AppShell>
  );
}
