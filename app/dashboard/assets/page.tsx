import type { Metadata } from "next";
import { AppShell, PageHeading } from "@/components/layout/app-shell";
import { AssetManager } from "./asset-manager";

export const metadata: Metadata = { title: "Assets" };

export default function AssetsPage() {
  return (
    <AppShell crumbs={["Northwind marketing", "Assets"]}>
      <PageHeading title="Assets" description="23 files · 2.1 MB total · 1.4 MB after optimisation" />
      <AssetManager />
    </AppShell>
  );
}
