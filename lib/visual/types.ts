/**
 * Visual comparison (§25).
 *
 * Two independent signals, deliberately kept separate:
 *
 * - **DOM geometry** compares the rendered page's measured boxes against the
 *   Design IR. It yields differences with real numbers — "Hero padding is 88px,
 *   the design says 96px" — which a repair agent can act on directly.
 * - **Pixel diff** compares a screenshot against the Figma reference render. It
 *   catches everything geometry cannot see: wrong colours, missing images, bad
 *   font rendering. It says *where*, not *what*.
 *
 * The DOM signal is the one that makes differences fixable, so it drives the
 * repair loop. The pixel signal drives the score the user is shown, because
 * that is what "does it look right" actually means.
 */
export type DifferenceCategory =
  | "layout" | "spacing" | "typography" | "color"
  | "position" | "size" | "alignment" | "image" | "border" | "shadow";

export type DifferenceSeverity = "high" | "medium" | "low";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A measured element from the rendered page. */
export interface DomNode {
  /** Maps back to the Design IR node this element was generated from. */
  sourceNodeId?: string;
  selector: string;
  tagName: string;
  rect: Rect;
  padding: { top: number; right: number; bottom: number; left: number };
  fontSize?: number;
  fontWeight?: number;
  lineHeight?: number;
  color?: string;
  backgroundColor?: string;
  borderRadius?: number;
  textContent?: string;
}

export interface DomSnapshot {
  breakpoint: number;
  viewport: { width: number; height: number };
  nodes: DomNode[];
}

export interface VisualDifference {
  category: DifferenceCategory;
  severity: DifferenceSeverity;
  /** Short label, e.g. "Hero padding". */
  label: string;
  /** Human-readable delta, e.g. "96 vs 88px". */
  detail: string;
  expected: string;
  actual: string;
  sourceNodeId?: string;
  selector?: string;
  rect?: Rect;
  /** Absolute magnitude, used for ordering and scoring. */
  magnitude: number;
}

export interface MetricScores {
  spacing: number;
  typography: number;
  color: number;
  layout: number;
  components: number;
}

export interface ComparisonResult {
  breakpoint: number;
  similarity: number;
  metrics: MetricScores;
  differences: VisualDifference[];
  /** Fraction of pixels that differ, when a pixel diff was run. */
  pixelDelta?: number;
  matchedNodes: number;
  unmatchedNodes: number;
}
