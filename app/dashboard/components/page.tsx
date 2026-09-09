import type { Metadata } from "next";
import { AppShell, PageHeading } from "@/components/layout/app-shell";
import { ComponentLibrary } from "./component-library";

export const metadata: Metadata = { title: "Components" };

export default function ComponentsPage() {
  return (
    <AppShell crumbs={["Components"]}>
      <PageHeading title="Components" description="Shared across every project in this workspace." />
      <ComponentLibrary />
    </AppShell>
  );
}
