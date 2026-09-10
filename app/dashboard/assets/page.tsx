import type { Metadata } from "next";
import Link from "next/link";
import { ImageIcon } from "lucide-react";
import { AppShell, PageHeading } from "@/components/layout/app-shell";
import { DemoBanner } from "@/components/layout/demo-banner";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonClasses } from "@/components/ui/button";
import { requireSession } from "@/lib/auth/session";
import { assetTotals, listAssets } from "@/lib/repositories/library";
import { formatBytes } from "@/lib/utils";
import { AssetManager } from "./asset-manager";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Assets" };

export default async function AssetsPage() {
  const session = await requireSession();
  const assets = await listAssets(session);
  const totals = assetTotals(assets);

  return (
    <AppShell crumbs={["Assets"]}>
      {session.demo && <DemoBanner />}
      <PageHeading
        title="Assets"
        // Was a fixed "23 files · 2.1 MB total · 1.4 MB after optimisation".
        description={
          totals.count > 0
            ? `${totals.count} ${totals.count === 1 ? "file" : "files"} · ${formatBytes(totals.bytes)} total · ` +
              `${formatBytes(totals.optimisedBytes)} after optimisation`
            : "Images, icons, fonts and video pulled from your designs."
        }
      />
      {assets.length === 0 ? (
        <EmptyState
          icon={<ImageIcon />}
          title="No assets yet"
          body="Assets are extracted when you import a Figma file — images, icons, fonts and video, ready to optimise."
          action={
            <Link href="/dashboard/import" className={buttonClasses("primary", "sm")}>
              Import a design
            </Link>
          }
        />
      ) : (
        <AssetManager assets={assets} />
      )}
    </AppShell>
  );
}
