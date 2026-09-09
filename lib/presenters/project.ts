import type { FrameworkKey, ProjectRow, ProjectStatus, StylingKey } from "@/lib/db/database.types";

/**
 * Presenters turn database rows into what the UI renders.
 *
 * They exist so components never encode database enums or formatting rules, and
 * so a schema change touches one file rather than every screen.
 */
export const FRAMEWORK_LABEL: Record<FrameworkKey, string> = {
  nextjs: "Next.js", react: "React", vue: "Vue", html: "HTML/CSS",
};

export const FRAMEWORK_COLOUR: Record<FrameworkKey, string> = {
  nextjs: "#111111", react: "#61DAFB", vue: "#42B883", html: "#E44D26",
};

export const STYLING_LABEL: Record<StylingKey, string> = {
  tailwind: "Tailwind CSS", css_modules: "CSS Modules", vanilla_css: "Vanilla CSS",
};

export const STATUS_PRESENTATION: Record<
  ProjectStatus,
  { label: string; tone: "success" | "accent" | "warning" | "neutral" | "error"; dot: boolean }
> = {
  live: { label: "Live", tone: "success", dot: true },
  generating: { label: "Generating", tone: "accent", dot: true },
  analysing: { label: "Analysing", tone: "accent", dot: true },
  importing: { label: "Importing", tone: "accent", dot: true },
  review: { label: "Needs review", tone: "warning", dot: false },
  draft: { label: "Draft", tone: "neutral", dot: false },
  failed: { label: "Build failed", tone: "error", dot: false },
};

const MINUTE = 60;
const HOUR = 3600;
const DAY = 86400;
const WEEK = 604800;
const MONTH = 2629800;

/** Relative time for list views. Intl does the wording, so no date dependency. */
export function relativeTime(iso: string, now = Date.now()): string {
  const seconds = Math.round((now - new Date(iso).getTime()) / 1000);
  if (seconds < MINUTE) return "Just now";

  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (seconds < HOUR) return formatter.format(-Math.round(seconds / MINUTE), "minute");
  if (seconds < DAY) return formatter.format(-Math.round(seconds / HOUR), "hour");
  if (seconds < WEEK) return formatter.format(-Math.round(seconds / DAY), "day");
  if (seconds < MONTH) return formatter.format(-Math.round(seconds / WEEK), "week");
  return formatter.format(-Math.round(seconds / MONTH), "month");
}

export interface ProjectCardModel {
  id: string;
  slug: string;
  name: string;
  brand: string;
  headline: string;
  frameworkLabel: string;
  frameworkColour: string;
  stylingLabel: string;
  editedAt: string;
  status: (typeof STATUS_PRESENTATION)[ProjectStatus];
  meta: string;
  dark: boolean;
}

export function toProjectCard(project: ProjectRow, now = Date.now()): ProjectCardModel {
  const meta =
    project.status === "failed"
      ? "Last build failed"
      : project.match_score !== null
        ? `${Math.round(project.match_score)}% visual match`
        : "Not generated yet";

  return {
    id: project.id,
    slug: project.slug,
    name: project.name,
    brand: project.name.split(" ")[0],
    // Until a real thumbnail exists, the description stands in for page copy.
    headline: project.description ?? "Ship your ideas without the rebuild.",
    frameworkLabel: FRAMEWORK_LABEL[project.framework],
    frameworkColour: FRAMEWORK_COLOUR[project.framework],
    stylingLabel: STYLING_LABEL[project.styling],
    editedAt: relativeTime(project.updated_at, now),
    status: STATUS_PRESENTATION[project.status],
    meta,
    dark: false,
  };
}
