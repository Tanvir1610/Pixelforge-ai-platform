import type { Metadata } from "next";
import { AppShell, PageHeading } from "@/components/layout/app-shell";
import { DemoBanner } from "@/components/layout/demo-banner";
import { requireSession } from "@/lib/auth/session";
import { listComponents } from "@/lib/repositories/library";
import { ComponentLibrary } from "./component-library";

// Session-dependent: rendering this at build time would bake one account's
// component library into a page served to everyone.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Components" };

export default async function ComponentsPage() {
  const session = await requireSession();
  const components = await listComponents(session);

  return (
    <AppShell crumbs={["Components"]}>
      {session.demo && <DemoBanner />}
      <PageHeading
        title="Components"
        description={
          components.length > 0
            ? `${components.length} detected across every project in this workspace.`
            : "Shared across every project in this workspace."
        }
      />
      <ComponentLibrary components={components} />
    </AppShell>
  );
}
