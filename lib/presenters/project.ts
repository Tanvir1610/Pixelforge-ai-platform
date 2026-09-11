import type { FrameworkKey, ProjectRow, ProjectStatus, StylingKey } from "@/lib/db/database.types";
import type { Project } from "@/types";

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
    // The description the user wrote, or nothing. It used to fall back to the
    // sample project's tagline, so every project without a description
    // advertised "Ship your ideas without the rebuild." as if it were its own.
    headline: project.description ?? "",
    frameworkLabel: FRAMEWORK_LABEL[project.framework],
    frameworkColour: FRAMEWORK_COLOUR[project.framework],
    stylingLabel: STYLING_LABEL[project.styling],
    editedAt: relativeTime(project.updated_at, now),
    status: STATUS_PRESENTATION[project.status],
    meta,
    dark: false,
  };
}

const FRAMEWORK_VIEW: Record<FrameworkKey, Project["framework"]> = {
  nextjs: "Next.js", react: "React", vue: "Vue", html: "HTML/CSS",
};

const STYLING_VIEW: Record<StylingKey, Project["styling"]> = {
  tailwind: "Tailwind CSS", css_modules: "CSS Modules", vanilla_css: "Vanilla CSS",
};

/** Counts the workspace header reports, from the project's own data. */
export interface WorkspaceCounts {
  /** Frames imported, which is what "pages" means before anything is generated. */
  pages: number;
  components: number;
  generatedFiles: number;
}

/**
 * A real project, as the workspace screens want it.
 *
 * Preview, Code, Design and Responsive each built their view model as
 * `{ ...getProject(id), id: real.id, name: real.name }` — the sample project
 * with two fields swapped. So a user's own project was reported as Next.js with
 * Tailwind, six pages, fourteen components and a 97% match, taken wholesale
 * from a fixture called "Northwind marketing", regardless of what they had
 * actually imported or chosen.
 */
export function toWorkspaceProject(
  project: ProjectRow,
  counts: Partial<WorkspaceCounts> = {},
  now = Date.now(),
): Project {
  const pages = counts.pages ?? 0;
  const components = counts.components ?? 0;
  const generatedFiles = counts.generatedFiles ?? 0;

  const meta =
    project.status === "failed"
      ? "Last build failed"
      : generatedFiles > 0
        ? `${generatedFiles} ${generatedFiles === 1 ? "file" : "files"} generated`
        : pages > 0
          ? `${pages} ${pages === 1 ? "frame" : "frames"} imported · not generated`
          : "No design imported yet";

  return {
    id: project.id,
    name: project.name,
    framework: FRAMEWORK_VIEW[project.framework],
    styling: STYLING_VIEW[project.styling],
    status: project.status === "analysing" || project.status === "importing" ? "generating" : project.status,
    editedAt: relativeTime(project.updated_at, now),
    meta,
    pages,
    components,
    // Only present once something measured it. The fixture supplied 97.
    matchScore: project.match_score === null ? undefined : Math.round(project.match_score),
    brand: project.name.split(" ")[0],
    headline: project.description ?? "",
  };
}
