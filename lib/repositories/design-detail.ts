import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { DesignAssetRow, DesignNodeRow, FigmaFrameRow } from "@/lib/db/database.types";
import type { Session } from "@/lib/auth/session";

/**
 * The rest of what an import actually found.
 *
 * The understanding screen showed real components, typography, colours and
 * spacing, and beside them four panels that were fixtures: a layout tree
 * describing a "Home" page nobody imported, an asset summary reading
 * "Images 8 · 1.9 MB", four invented interaction rows, four invented responsive
 * rules, and a warning that Söhne was missing from a design that never
 * mentioned it.
 *
 * Those are the panels a user reads to decide whether the import understood
 * their file. Fabricated, they are worse than absent — they answer the question
 * confidently and wrongly. Everything here is read from what the import
 * persisted, and reports nothing rather than something plausible.
 */

/**
 * The counts the workspace header reports.
 *
 * Two cheap head counts rather than a full read: every workspace screen wants
 * "4 frames, 11 components" and none of them want the rows.
 */
export async function workspaceCounts(
  session: Session,
  projectId: string,
): Promise<{ pages: number; components: number }> {
  if (session.demo) return { pages: 0, components: 0 };

  const supabase = await createClient();
  if (!supabase) return { pages: 0, components: 0 };

  const [frames, components] = await Promise.all([
    supabase.from("figma_frames").select("id", { count: "exact", head: true }).eq("project_id", projectId),
    supabase.from("design_components").select("id", { count: "exact", head: true }).eq("project_id", projectId),
  ]);

  return { pages: frames.count ?? 0, components: components.count ?? 0 };
}

/** Roles that correspond to a landmark element, which is what the tree labels. */
const ROLE_TAGS: Record<string, string> = {
  navbar: "header", nav: "nav", hero: "section", feature_grid: "section",
  feature_card: "article", pricing_section: "section", pricing_plan: "article",
  testimonial: "section", cta: "section", footer: "footer", sidebar: "aside",
  form: "form", list: "ul", modal: "dialog", table: "table", heading: "h2",
  paragraph: "p", button: "button", input: "input",
};

export interface LayoutNode {
  id: string;
  depth: number;
  /** The HTML landmark this maps to, when the role implies one. */
  tag: string | null;
  name: string;
  detail: string;
}

export interface AssetGroup {
  kind: DesignAssetRow["kind"];
  label: string;
  count: number;
  bytes: number;
}

export interface InteractionSummary {
  /** The element, named as the designer named it. */
  label: string;
  triggers: string[];
  /** True when every interaction on it was derived rather than found in the file. */
  inferred: boolean;
}

export interface ResponsiveRule {
  label: string;
  rule: string;
  /** Derived by the analyser rather than observed in the file. The UI says so. */
  derived: boolean;
}

export interface FontUsage {
  family: string;
  uses: number;
  /** No font file of that family was imported, so generation would substitute. */
  missing: boolean;
}

export interface DesignDetail {
  frameName: string;
  frameWidth: number;
  frameHeight: number;
  layout: LayoutNode[];
  /** Top-level sections in the widest frame — what the panel badge counts. */
  sectionCount: number;
  assets: AssetGroup[];
  assetCount: number;
  assetBytes: number;
  interactions: InteractionSummary[];
  responsive: ResponsiveRule[];
  fonts: FontUsage[];
  /** Common divisor of the spacing scale, when the scale has one. */
  spacingBase: number | null;
  /** The commonest section padding, as "96 vertical, 80 horizontal". */
  sectionPadding: string | null;
  /** Frame widths, which are the breakpoints the designer actually drew. */
  breakpoints: number[];
}

const ASSET_LABELS: Record<DesignAssetRow["kind"], string> = {
  image: "Images", icon: "Icons", svg: "SVG illustrations", font: "Fonts", video: "Video",
};

/** How deep the structure panel reads. Past this it stops being a structure. */
const LAYOUT_MAX_DEPTH = 2;

export type LayoutRow = Pick<
  DesignNodeRow,
  | "id" | "name" | "ir_type" | "semantic_role" | "depth" | "parent_id" | "order_index"
  | "y" | "width" | "height" | "layout_mode" | "layout_gap"
  | "padding_top" | "padding_right" | "padding_bottom" | "padding_left"
  | "align_items" | "justify_content" | "sizing_vertical"
  | "font_size" | "line_height"
>;

export type BehaviourRow = Pick<
  DesignNodeRow,
  "id" | "name" | "semantic_role" | "interactions" | "responsive_hints"
>;

/** "vertical, gap 24 · padding 96 80" — the facts a developer would ask for. */
export function describeLayout(row: LayoutRow): string {
  const parts: string[] = [];

  if (row.depth === 0) {
    parts.push(`${Math.round(Number(row.width ?? 0))} × ${Math.round(Number(row.height ?? 0))}`);
  }

  const mode = row.layout_mode ?? "none";
  if (mode === "vertical" || mode === "horizontal") {
    const gap = Math.round(Number(row.layout_gap ?? 0));
    parts.push(gap > 0 ? `${mode}, gap ${gap}` : mode);
  } else if (mode === "grid") {
    parts.push("grid");
  }

  if (row.justify_content && row.justify_content !== "start") parts.push(row.justify_content);
  else if (row.align_items === "center") parts.push("centred");

  const top = Math.round(Number(row.padding_top ?? 0));
  const bottom = Math.round(Number(row.padding_bottom ?? 0));
  const left = Math.round(Number(row.padding_left ?? 0));
  const right = Math.round(Number(row.padding_right ?? 0));
  if (top || bottom || left || right) {
    parts.push(
      top === bottom && left === right
        ? `padding ${top} ${left}`
        : `padding ${top} ${right} ${bottom} ${left}`,
    );
  }

  const size = Math.round(Number(row.font_size ?? 0));
  if (size > 0) {
    const leading = Math.round(Number(row.line_height ?? 0));
    parts.push(leading > 0 ? `${size}/${leading}` : `${size}px`);
  }

  if (parts.length === 0 && row.sizing_vertical === "hug") parts.push("hug height");

  return parts.join(" · ");
}

/** Reduces the spacing scale to its base unit, which is what designers work in. */
export function baseUnit(values: number[]): number | null {
  const whole = values.map((value) => Math.round(value)).filter((value) => value > 0);
  if (whole.length < 2) return null;

  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const unit = whole.reduce((accumulator, value) => gcd(accumulator, value));
  // A base of 1 means the scale has no rhythm; "base unit 1px" is noise.
  return unit > 1 ? unit : null;
}

function commonest(values: string[]): string | null {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);

  let best: string | null = null;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

/** Normalised for comparing a font family against an imported file's name. */
const fontKey = (value: string) => value.toLowerCase().replace(/[^a-z]/g, "");

export function summariseInteractions(nodes: BehaviourRow[]): InteractionSummary[] {
  const byLabel = new Map<string, InteractionSummary>();

  for (const node of nodes) {
    const list = Array.isArray(node.interactions)
      ? (node.interactions as { trigger?: string; inferred?: boolean }[])
      : [];
    if (list.length === 0) continue;

    const triggers = [...new Set(list.map((item) => item.trigger).filter(Boolean))] as string[];
    if (triggers.length === 0) continue;

    const entry: InteractionSummary = {
      label: node.name,
      triggers,
      inferred: list.every((item) => item.inferred === true),
    };

    // One row per distinct element, keeping the richest example of each: the
    // panel lists what kinds of element are interactive, not every instance.
    const existing = byLabel.get(entry.label);
    if (!existing || entry.triggers.length > existing.triggers.length) byLabel.set(entry.label, entry);
  }

  return [...byLabel.values()].sort((a, b) => b.triggers.length - a.triggers.length).slice(0, 12);
}

interface Hints {
  collapsesAtWidth?: number;
  columnsByBreakpoint?: Record<string, number>;
  hiddenBelowWidth?: number;
  fontScaleByBreakpoint?: Record<string, number>;
}

export function summariseResponsive(nodes: BehaviourRow[]): ResponsiveRule[] {
  const rules: ResponsiveRule[] = [];

  for (const node of nodes) {
    const hints = node.responsive_hints as Hints | null;
    if (!hints || typeof hints !== "object") continue;

    // Widest first, so the rule reads the way the layout degrades.
    const columns = hints.columnsByBreakpoint
      ? Object.entries(hints.columnsByBreakpoint)
          .sort(([a], [b]) => Number(b) - Number(a))
          .map(([, count]) => count)
      : [];

    if (columns.length > 1) {
      rules.push({ label: node.name, rule: `${columns.join(" → ")} columns`, derived: true });
    } else if (typeof hints.hiddenBelowWidth === "number") {
      rules.push({ label: node.name, rule: `Hidden below ${hints.hiddenBelowWidth}px`, derived: true });
    } else if (typeof hints.collapsesAtWidth === "number") {
      rules.push({ label: node.name, rule: `Collapses below ${hints.collapsesAtWidth}px`, derived: true });
    } else if (hints.fontScaleByBreakpoint) {
      const scales = Object.entries(hints.fontScaleByBreakpoint).sort(([a], [b]) => Number(b) - Number(a));
      if (scales.length > 1) {
        rules.push({
          label: node.name,
          rule: scales.map(([, scale]) => `${Math.round(scale * 100)}%`).join(" → "),
          derived: true,
        });
      }
    }
  }

  return rules.slice(0, 8);
}

export async function getDesignDetail(
  session: Session,
  projectId: string,
): Promise<DesignDetail | null> {
  if (session.demo) return null;

  const supabase = await createClient();
  if (!supabase) return null;

  const { data: frames } = await supabase
    .from("figma_frames")
    .select("id, name, width, height")
    .eq("project_id", projectId)
    .order("width", { ascending: false })
    .overrideTypes<Pick<FigmaFrameRow, "id" | "name" | "width" | "height">[]>();

  const widest = frames?.[0];
  if (!widest) return null;

  const [structure, behaviour, assets, typefaces, fontFiles] = await Promise.all([
    // The tree comes from the widest frame alone: a structure panel with three
    // breakpoints interleaved is not a structure.
    supabase
      .from("design_nodes")
      .select(
        "id, name, ir_type, semantic_role, depth, parent_id, order_index, y, width, height, " +
          "layout_mode, layout_gap, padding_top, padding_right, padding_bottom, padding_left, " +
          "align_items, justify_content, sizing_vertical, font_size, line_height",
      )
      .eq("figma_frame_id", widest.id)
      .lte("depth", LAYOUT_MAX_DEPTH)
      .order("depth")
      .order("order_index")
      .limit(200)
      .overrideTypes<LayoutRow[]>(),

    // Behaviour across every frame: a rule found at one breakpoint is still a
    // rule, and hidden-below hints only exist on the narrow ones.
    supabase
      .from("design_nodes")
      .select("id, name, semantic_role, interactions, responsive_hints")
      .eq("project_id", projectId)
      .limit(1000)
      .overrideTypes<BehaviourRow[]>(),

    supabase
      .from("design_assets")
      .select("kind, bytes")
      .eq("project_id", projectId)
      .overrideTypes<Pick<DesignAssetRow, "kind" | "bytes">[]>(),

    supabase
      .from("design_nodes")
      .select("font_family")
      .eq("project_id", projectId)
      .not("font_family", "is", null)
      .limit(1000)
      .overrideTypes<{ font_family: string | null }[]>(),

    supabase
      .from("design_assets")
      .select("name")
      .eq("project_id", projectId)
      .eq("kind", "font")
      .overrideTypes<{ name: string }[]>(),
  ]);

  const rows = structure.data ?? [];

  // Only nodes whose parent is also in the frame, so an orphaned row cannot
  // appear at the root of the tree as if it were a section of its own.
  const byId = new Map(rows.map((row) => [row.id, row]));
  const layout: LayoutNode[] = rows
    .filter((row) => row.depth === 0 || (row.parent_id !== null && byId.has(row.parent_id)))
    .sort((a, b) => a.depth - b.depth || Number(a.y ?? 0) - Number(b.y ?? 0))
    .map((row) => ({
      id: row.id,
      depth: row.depth,
      tag: row.semantic_role ? (ROLE_TAGS[row.semantic_role] ?? null) : null,
      name: row.name,
      detail: describeLayout(row),
    }));

  const sections = rows.filter((row) => row.depth === 1);
  const nodes = behaviour.data ?? [];

  const grouped = new Map<DesignAssetRow["kind"], { count: number; bytes: number }>();
  for (const asset of assets.data ?? []) {
    const entry = grouped.get(asset.kind) ?? { count: 0, bytes: 0 };
    entry.count += 1;
    entry.bytes += Number(asset.bytes ?? 0);
    grouped.set(asset.kind, entry);
  }

  const families = new Map<string, number>();
  for (const row of typefaces.data ?? []) {
    const family = row.font_family?.trim();
    if (family) families.set(family, (families.get(family) ?? 0) + 1);
  }

  // A family counts as present when some imported font file names it.
  const imported = (fontFiles.data ?? []).map((asset) => fontKey(asset.name));
  const fonts: FontUsage[] = [...families.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([family, uses]) => ({
      family,
      uses,
      missing: !imported.some((file) => file.includes(fontKey(family))),
    }));

  const paddings = sections
    .map((section) => ({
      vertical: Math.round(Number(section.padding_top ?? 0)),
      horizontal: Math.round(Number(section.padding_left ?? 0)),
    }))
    .filter((padding) => padding.vertical > 0 || padding.horizontal > 0)
    .map((padding) => `${padding.vertical} vertical, ${padding.horizontal} horizontal`);

  const spacingValues = rows.flatMap((row) =>
    [row.layout_gap, row.padding_top, row.padding_left, row.padding_bottom, row.padding_right]
      .map((value) => Number(value ?? 0))
      .filter((value) => value > 0),
  );

  return {
    frameName: widest.name,
    frameWidth: Math.round(Number(widest.width)),
    frameHeight: Math.round(Number(widest.height)),
    layout,
    sectionCount: sections.length,
    assets: [...grouped.entries()]
      .map(([kind, entry]) => ({ kind, label: ASSET_LABELS[kind] ?? kind, ...entry }))
      .sort((a, b) => b.bytes - a.bytes),
    assetCount: (assets.data ?? []).length,
    assetBytes: (assets.data ?? []).reduce((total, asset) => total + Number(asset.bytes ?? 0), 0),
    interactions: summariseInteractions(nodes),
    responsive: summariseResponsive(nodes),
    fonts,
    spacingBase: baseUnit(spacingValues),
    sectionPadding: commonest(paddings),
    // Frame widths are the breakpoints the designer actually drew, stated more
    // plainly than any inference from a single layout.
    breakpoints: [...new Set((frames ?? []).map((frame) => Math.round(Number(frame.width))))].sort(
      (a, b) => b - a,
    ),
  };
}
