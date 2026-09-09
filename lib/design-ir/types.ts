/**
 * Design IR — the platform's own representation of a design.
 *
 * This is the moat. The AI reasons over this, never over raw Figma JSON: the
 * Figma API shape is a vendor detail, it is far larger than the model needs,
 * and it carries no semantics. A second importer (Sketch, screenshots, code)
 * can target this same IR without touching anything downstream.
 *
 * Mirrors the `design_nodes` table one-to-one; see docs/DESIGN_IR.md.
 *
 * Status: types and validators implemented (Phase 1). The Figma importer that
 * produces them lands in Phase 2.
 */

export type IrNodeType =
  | "document" | "page" | "frame" | "section" | "container"
  | "text" | "image" | "vector" | "instance" | "component";

/**
 * Semantic roles are an open vocabulary. The list below is what the detector
 * currently emits; `(string & {})` keeps autocomplete while allowing new roles
 * without a schema migration, per §12 of the brief.
 */
export type SemanticRole =
  | "navbar" | "hero" | "cta" | "feature_grid" | "feature_card" | "pricing_section"
  | "pricing_plan" | "testimonial" | "footer" | "sidebar" | "card" | "button"
  | "input" | "form" | "modal" | "table" | "tabs" | "badge" | "avatar" | "logo"
  | "heading" | "paragraph" | "list" | "icon" | "media"
  | (string & {});

export type LayoutMode = "none" | "horizontal" | "vertical" | "grid";
export type Sizing = "fixed" | "hug" | "fill";

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Spacing {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface LayoutInfo {
  mode: LayoutMode;
  gap: number;
  padding: Spacing;
  alignItems?: "start" | "center" | "end" | "stretch" | "baseline";
  justifyContent?: "start" | "center" | "end" | "between" | "around";
  sizingHorizontal: Sizing;
  sizingVertical: Sizing;
  /** Column count when mode is "grid"; drives the responsive collapse rules. */
  columns?: number;
}

export interface TypographyInfo {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
  letterSpacing: number;
  color: string;
  textAlign?: "left" | "center" | "right" | "justify";
}

export interface StyleInfo {
  backgroundColor?: string;
  borderColor?: string;
  borderWidth?: number;
  borderRadius?: number;
  opacity?: number;
  effects: Effect[];
}

export interface Effect {
  type: "drop_shadow" | "inner_shadow" | "blur" | "background_blur";
  x?: number;
  y?: number;
  blur?: number;
  spread?: number;
  color?: string;
}

export interface ConstraintInfo {
  horizontal: "left" | "right" | "center" | "scale" | "stretch";
  vertical: "top" | "bottom" | "center" | "scale" | "stretch";
}

/**
 * What the analyser inferred about behaviour across widths. Kept separate from
 * `constraints` because constraints are *observed* from the file while these
 * are *derived*, and the UI shows the difference (§18: "Derived" badge).
 */
export interface ResponsiveHints {
  collapsesAtWidth?: number;
  columnsByBreakpoint?: Record<number, number>;
  hiddenBelowWidth?: number;
  fontScaleByBreakpoint?: Record<number, number>;
}

export interface Interaction {
  trigger: "hover" | "press" | "focus" | "click" | "drag";
  action: "navigate" | "open_overlay" | "close_overlay" | "scroll_to" | "change_state";
  target?: string;
  /** True when inferred rather than present in the source file. */
  inferred?: boolean;
}

export interface IrNode {
  id: string;
  type: IrNodeType;
  name: string;
  /** Original identifier in the source tool, kept for re-import and diffing. */
  sourceNodeId?: string;
  parentId: string | null;
  childIds: string[];
  orderIndex: number;
  depth: number;

  box: Box;
  layout: LayoutInfo;
  style: StyleInfo;
  typography?: TypographyInfo;
  textContent?: string;

  constraints?: ConstraintInfo;
  responsiveHints?: ResponsiveHints;
  interactions: Interaction[];

  semanticRole?: SemanticRole;
  /** 0–100. Anything below ~85 is surfaced for human review before generation. */
  confidence?: number;

  assetId?: string;
  componentId?: string;
}

export interface IrFrame {
  id: string;
  name: string;
  width: number;
  height: number;
  breakpoint?: number;
  rootNodeId: string;
}

export interface DesignDocument {
  projectId: string;
  sourceFileKey: string;
  name: string;
  version: string;
  frames: IrFrame[];
  /** Flat map rather than a nested tree: O(1) lookup, and it maps to one table. */
  nodes: Record<string, IrNode>;
  tokens: DesignToken[];
  components: IrComponent[];
  assets: IrAsset[];
}

export type TokenCategory =
  | "color" | "typography" | "spacing" | "radius" | "shadow" | "breakpoint" | "container" | "grid";

export interface DesignToken {
  name: string;
  category: TokenCategory;
  value: unknown;
  /** Variables and styles come from the file; "inferred" was derived by us. */
  source: "figma_variable" | "figma_style" | "inferred" | "manual";
  usageCount: number;
}

export interface IrComponent {
  id: string;
  name: string;
  semanticRole?: SemanticRole;
  confidence: number;
  instanceCount: number;
  variants: { name: string; properties: Record<string, string> }[];
  rootNodeId: string;
}

export interface IrAsset {
  id: string;
  name: string;
  kind: "image" | "icon" | "svg" | "font" | "video";
  mimeType?: string;
  bytes: number;
  storagePath: string;
  usageCount: number;
}

/** Walks the tree depth-first from a root node. */
export function* walk(document: DesignDocument, rootId: string): Generator<IrNode> {
  const root = document.nodes[rootId];
  if (!root) return;
  yield root;
  for (const childId of root.childIds) {
    yield* walk(document, childId);
  }
}

/** Every node carrying a given semantic role, in document order. */
export function findByRole(document: DesignDocument, role: SemanticRole): IrNode[] {
  return Object.values(document.nodes)
    .filter((node) => node.semanticRole === role)
    .sort((a, b) => a.depth - b.depth || a.orderIndex - b.orderIndex);
}

/** Nodes the detector was unsure about, worst first — what to review before generating. */
export function lowConfidenceNodes(document: DesignDocument, threshold = 85): IrNode[] {
  return Object.values(document.nodes)
    .filter((node) => node.confidence !== undefined && node.confidence < threshold)
    .sort((a, b) => (a.confidence ?? 0) - (b.confidence ?? 0));
}
