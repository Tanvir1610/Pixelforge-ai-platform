import type { Metadata } from "next";
import { AppShell, PageHeading } from "@/components/layout/app-shell";
import { SettingsForm } from "./settings-form";

export const metadata: Metadata = { title: "Project settings" };

export default function SettingsPage() {
  return (
    <AppShell crumbs={["Northwind marketing", "Settings"]}>
      <PageHeading title="Project settings" description="Changes apply to the next generation unless noted." />
      <SettingsForm />
    </AppShell>
  );
}
