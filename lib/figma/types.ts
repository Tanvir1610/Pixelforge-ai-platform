/**
 * The subset of the Figma REST API we consume.
 *
 * Deliberately partial: everything here is read by the normaliser and then
 * discarded. Nothing downstream of `lib/figma/` may import these types — the
 * boundary is the Design IR, so a Figma API change stops at the normaliser.
 */

export interface FigmaColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface FigmaPaint {
  type: "SOLID" | "GRADIENT_LINEAR" | "GRADIENT_RADIAL" | "IMAGE" | string;
  visible?: boolean;
  opacity?: number;
  color?: FigmaColor;
  imageRef?: string;
}

export interface FigmaEffect {
  type: "DROP_SHADOW" | "INNER_SHADOW" | "LAYER_BLUR" | "BACKGROUND_BLUR" | string;
  visible?: boolean;
  radius?: number;
  spread?: number;
  color?: FigmaColor;
  offset?: { x: number; y: number };
}

export interface FigmaTypeStyle {
  fontFamily?: string;
  fontPostScriptName?: string | null;
  fontWeight?: number;
  fontSize?: number;
  lineHeightPx?: number;
  letterSpacing?: number;
  textAlignHorizontal?: "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED";
}

export interface FigmaRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FigmaConstraints {
  vertical: "TOP" | "BOTTOM" | "CENTER" | "TOP_BOTTOM" | "SCALE";
  horizontal: "LEFT" | "RIGHT" | "CENTER" | "LEFT_RIGHT" | "SCALE";
}

export interface FigmaNode {
  id: string;
  name: string;
  type: string;
  visible?: boolean;
  children?: FigmaNode[];

  absoluteBoundingBox?: FigmaRect | null;
  constraints?: FigmaConstraints;

  layoutMode?: "NONE" | "HORIZONTAL" | "VERTICAL";
  itemSpacing?: number;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  primaryAxisAlignItems?: "MIN" | "CENTER" | "MAX" | "SPACE_BETWEEN";
  counterAxisAlignItems?: "MIN" | "CENTER" | "MAX" | "BASELINE";
  layoutGrow?: number;
  layoutAlign?: string;
  layoutSizingHorizontal?: "FIXED" | "HUG" | "FILL";
  layoutSizingVertical?: "FIXED" | "HUG" | "FILL";
  layoutWrap?: "NO_WRAP" | "WRAP";

  fills?: FigmaPaint[];
  strokes?: FigmaPaint[];
  strokeWeight?: number;
  cornerRadius?: number;
  rectangleCornerRadii?: number[];
  effects?: FigmaEffect[];
  opacity?: number;

  characters?: string;
  style?: FigmaTypeStyle;

  componentId?: string;
  componentSetId?: string;
  /** Present on COMPONENT nodes inside a component set: "Size=lg, State=hover". */
  variantProperties?: Record<string, string> | null;
}

export interface FigmaComponentMeta {
  key: string;
  name: string;
  description?: string;
  componentSetId?: string;
}

export interface FigmaStyleMeta {
  key: string;
  name: string;
  styleType: "FILL" | "TEXT" | "EFFECT" | "GRID";
  description?: string;
}

export interface FigmaFileResponse {
  name: string;
  version: string;
  lastModified: string;
  document: FigmaNode;
  components: Record<string, FigmaComponentMeta>;
  componentSets?: Record<string, FigmaComponentMeta>;
  styles: Record<string, FigmaStyleMeta>;
}

export interface FigmaImagesResponse {
  err: string | null;
  images: Record<string, string | null>;
}

/** Parsed form of a Figma file URL. */
export interface FigmaFileRef {
  fileKey: string;
  /** From ?node-id=142-8, normalised to the "142:8" the API expects. */
  nodeId?: string;
}
