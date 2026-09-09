import type { OrganizationRow, ProfileRow, ProjectRow } from "@/lib/db/database.types";
import { PROJECTS } from "@/lib/data";

/**
 * Demo mode.
 *
 * When Supabase is not configured the app serves this seeded data so the UI is
 * fully explorable. It is deliberately kept in one file, clearly named, and
 * every screen that uses it shows a "Demo data" badge — the failure mode we are
 * avoiding is a reviewer mistaking mock output for working infrastructure.
 */
const NOW = "2026-01-01T09:00:00.000Z";

export const DEMO_PROFILE: ProfileRow = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "tanvir@basalt.studio",
  full_name: "Tanvir Ahmad",
  avatar_url: null,
  onboarded_at: NOW,
  created_at: NOW,
  updated_at: NOW,
};

export const DEMO_ORGANIZATION: OrganizationRow = {
  id: "00000000-0000-4000-8000-000000000002",
  name: "Basalt Studio",
  slug: "basalt-studio",
  plan: "pro",
  ai_credits_limit: 2000,
  created_by: DEMO_PROFILE.id,
  created_at: NOW,
  updated_at: NOW,
  deleted_at: null,
};

const STATUS_MAP: Record<string, ProjectRow["status"]> = {
  live: "live", generating: "generating", review: "review", draft: "draft", failed: "failed",
};

const FRAMEWORK_MAP: Record<string, ProjectRow["framework"]> = {
  "Next.js": "nextjs", React: "react", Vue: "vue", "HTML/CSS": "html",
};

const STYLING_MAP: Record<string, ProjectRow["styling"]> = {
  "Tailwind CSS": "tailwind", "CSS Modules": "css_modules", "Vanilla CSS": "vanilla_css",
};

export const DEMO_PROJECTS: ProjectRow[] = PROJECTS.map((project, index) => ({
  id: `00000000-0000-4000-8000-00000000010${index}`,
  organization_id: DEMO_ORGANIZATION.id,
  name: project.name,
  slug: project.id,
  description: null,
  status: STATUS_MAP[project.status] ?? "draft",
  framework: FRAMEWORK_MAP[project.framework] ?? "nextjs",
  styling: STYLING_MAP[project.styling] ?? "tailwind",
  typescript: true,
  responsive: true,
  host_provider: project.status === "live" ? "vercel" : "none",
  match_score: project.matchScore ?? null,
  thumbnail_path: null,
  created_by: DEMO_PROFILE.id,
  created_at: NOW,
  updated_at: NOW,
  deleted_at: null,
}));
