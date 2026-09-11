export type Framework = "Next.js" | "React" | "Vue" | "HTML/CSS";
export type Styling = "Tailwind CSS" | "CSS Modules" | "Vanilla CSS";
export type HostProvider = "None" | "Vercel" | "Netlify" | "Cloudflare";

export type ProjectStatus = "live" | "generating" | "review" | "draft" | "failed";

export interface Project {
  id: string;
  name: string;
  framework: Framework;
  styling: Styling;
  status: ProjectStatus;
  editedAt: string;
  meta: string;
  pages: number;
  components: number;
  matchScore?: number;
  progress?: number;
  theme?: "light" | "dark";
  brand: string;
  headline: string;
}

/** The lifecycle an AI task moves through. Drives every progress affordance. */
export type TaskState = "pending" | "active" | "done" | "failed";

export interface AnalysisStep {
  id: string;
  label: string;
  state: TaskState;
  result?: string;
}

export interface GenerationTask {
  id: string;
  label: string;
  state: TaskState;
  result?: string;
}

export interface DetectedComponent {
  name: string;
  confidence: number;
  icon: string;
}

export interface MatchMetric {
  label: string;
  value: number;
}

export interface VisualDifference {
  id: string;
  label: string;
  detail: string;
  severity: "high" | "medium";
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  body: string;
  findings?: { label: string; detail: string }[];
  files?: string[];
  actions?: boolean;
  status?: string;
}

export type DeviceKey = "desktop" | "tablet" | "mobile";

export interface Device {
  key: DeviceKey;
  label: string;
  width: number;
}

export interface AssetItem {
  id: string;
  name: string;
  kind: "Image" | "Icon" | "SVG" | "Font" | "Video";
  bytes: number;
  uses: number;
  needsOptimising?: boolean;
  /**
   * Short-lived signed URL for the stored object.
   *
   * Every bucket is private, so this is the only way the browser sees an asset.
   * Absent for the demo fixtures, which have no object behind them.
   */
  url?: string | null;
}

export interface ComponentEntry {
  id: string;
  name: string;
  usage: number;
  variants: string[];
  states?: string[];
}

export interface Deployment {
  id: string;
  hash: string;
  status: "ready" | "failed" | "building";
  branch: string;
  time: string;
}
