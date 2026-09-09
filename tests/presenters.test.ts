import { describe, expect, it } from "vitest";
import { relativeTime, toProjectCard } from "@/lib/presenters/project";
import type { ProjectRow } from "@/lib/db/database.types";

const base: ProjectRow = {
  id: "1", organization_id: "org", name: "Northwind marketing", slug: "northwind",
  description: null, status: "live", framework: "nextjs", styling: "tailwind",
  typescript: true, responsive: true, host_provider: "vercel", match_score: 97,
  thumbnail_path: null, created_by: "u1",
  created_at: "2026-01-01T09:00:00.000Z", updated_at: "2026-01-01T09:00:00.000Z", deleted_at: null,
};

const NOW = new Date("2026-01-01T11:00:00.000Z").getTime();

describe("relativeTime", () => {
  it("reports very recent edits as Just now", () => {
    expect(relativeTime("2026-01-01T10:59:30.000Z", NOW)).toBe("Just now");
  });

  it("scales through minutes, hours and days", () => {
    expect(relativeTime("2026-01-01T10:30:00.000Z", NOW)).toBe("30 minutes ago");
    expect(relativeTime("2026-01-01T09:00:00.000Z", NOW)).toBe("2 hours ago");
    expect(relativeTime("2025-12-29T11:00:00.000Z", NOW)).toBe("3 days ago");
  });
});

describe("toProjectCard", () => {
  it("maps database enums to display labels", () => {
    const card = toProjectCard(base, NOW);
    expect(card.frameworkLabel).toBe("Next.js");
    expect(card.stylingLabel).toBe("Tailwind CSS");
    expect(card.status.label).toBe("Live");
    expect(card.meta).toBe("97% visual match");
  });

  it("explains a project that has not been generated", () => {
    expect(toProjectCard({ ...base, match_score: null }, NOW).meta).toBe("Not generated yet");
  });

  it("prioritises the failure message over the score", () => {
    expect(toProjectCard({ ...base, status: "failed" }, NOW).meta).toBe("Last build failed");
  });

  it("covers every project status", () => {
    const statuses = ["draft", "importing", "analysing", "generating", "review", "live", "failed"] as const;
    for (const status of statuses) {
      expect(toProjectCard({ ...base, status }, NOW).status.label).toBeTruthy();
    }
  });
});
