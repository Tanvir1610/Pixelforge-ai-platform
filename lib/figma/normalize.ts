import type {
  ConstraintInfo, DesignDocument, Effect, IrFrame, IrNode, IrNodeType, LayoutInfo, Sizing,
} from "@/lib/design-ir/types";
import type { FigmaFileResponse, FigmaNode } from "./types";
import { paintToCss, toRgba } from "./color";
import { detectRole } from "./semantics";
import { extractTokens } from "./tokens";
import { inferResponsive } from "./responsive";

/**
 * Figma → Design IR.
 *
 * A pure function: no network, no database, no clock. That is what makes the
 * hardest part of the platform unit-testable, and it is why the importer is
 * split into fetch (client.ts) and transform (here).
 */

const TYPE_MAP: Record<string, IrNodeType> = {
  DOCUMENT: "document",
  CANVAS: "page",
  FRAME: "frame",
  SECTION: "section",
  GROUP: "container",
  COMPONENT: "component",
  COMPONENT_SET: "component",
  INSTANCE: "instance",
  TEXT: "text",
  RECTANGLE: "container",
  ELLIPSE: "vector",
  VECTOR: "vector",
  LINE: "vector",
  STAR: "vector",
  POLYGON: "vector",
  BOOLEAN_OPERATION: "vector",
};

function mapType(figmaType: string): IrNodeType {
  return TYPE_MAP[figmaType] ?? "container";
}

/** An image fill makes a rectangle an image, not a box with a colour. */
function isImageNode(node: FigmaNode): boolean {
  return Boolean(node.fills?.some((fill) => fill.type === "IMAGE" && fill.visible !== false));
}

function mapSizing(value: string | undefined, fallback: Sizing): Sizing {
  if (value === "FIXED") return "fixed";
  if (value === "HUG") return "hug";
  if (value === "FILL") return "fill";
  return fallback;
}

function mapAlign(value: string | undefined): LayoutInfo["alignItems"] {
  switch (value) {
    case "MIN": return "start";
    case "CENTER": return "center";
    case "MAX": return "end";
    case "BASELINE": return "baseline";
    default: return undefined;
  }
}

function mapJustify(value: string | undefined): LayoutInfo["justifyContent"] {
  switch (value) {
    case "MIN": return "start";
    case "CENTER": return "center";
    case "MAX": return "end";
    case "SPACE_BETWEEN": return "between";
    default: return undefined;
  }
}

function mapConstraints(node: FigmaNode): ConstraintInfo | undefined {
  if (!node.constraints) return undefined;
  const horizontal = { LEFT: "left", RIGHT: "right", CENTER: "center", LEFT_RIGHT: "stretch", SCALE: "scale" } as const;
  const vertical = { TOP: "top", BOTTOM: "bottom", CENTER: "center", TOP_BOTTOM: "stretch", SCALE: "scale" } as const;
  return {
    horizontal: horizontal[node.constraints.horizontal] ?? "left",
    vertical: vertical[node.constraints.vertical] ?? "top",
  };
}

function mapEffects(node: FigmaNode): Effect[] {
  return (node.effects ?? [])
    .filter((effect) => effect.visible !== false)
    .map((effect) => ({
      type:
        effect.type === "DROP_SHADOW" ? "drop_shadow"
        : effect.type === "INNER_SHADOW" ? "inner_shadow"
        : effect.type === "BACKGROUND_BLUR" ? "background_blur"
        : "blur",
      x: effect.offset?.x,
      y: effect.offset?.y,
      blur: effect.radius,
      spread: effect.spread,
      color: effect.color ? toRgba(effect.color) : undefined,
    }));
}

/**
 * Figma reports absolute page coordinates. The IR stores positions relative to
 * the parent, because that is what a layout engine needs and what survives a
 * frame being moved on the canvas.
 */
function relativeBox(node: FigmaNode, parent: FigmaNode | null) {
  const box = node.absoluteBoundingBox;
  if (!box) return { x: 0, y: 0, width: 0, height: 0 };
  const origin = parent?.absoluteBoundingBox;
  return {
    x: origin ? Math.round((box.x - origin.x) * 100) / 100 : 0,
    y: origin ? Math.round((box.y - origin.y) * 100) / 100 : 0,
    width: Math.round(box.width * 100) / 100,
    height: Math.round(box.height * 100) / 100,
  };
}

function buildLayout(node: FigmaNode): LayoutInfo {
  const mode =
    node.layoutMode === "HORIZONTAL" ? "horizontal"
    : node.layoutMode === "VERTICAL" ? "vertical"
    : "none";

  // Auto layout that wraps is a grid in every meaningful sense.
  const isGrid = mode === "horizontal" && node.layoutWrap === "WRAP";

  return {
    mode: isGrid ? "grid" : mode,
    gap: node.itemSpacing ?? 0,
    padding: {
      top: node.paddingTop ?? 0,
      right: node.paddingRight ?? 0,
      bottom: node.paddingBottom ?? 0,
      left: node.paddingLeft ?? 0,
    },
    alignItems: mapAlign(node.counterAxisAlignItems),
    justifyContent: mapJustify(node.primaryAxisAlignItems),
    sizingHorizontal: mapSizing(node.layoutSizingHorizontal, node.layoutGrow ? "fill" : "fixed"),
    sizingVertical: mapSizing(node.layoutSizingVertical, "hug"),
    columns: isGrid ? (node.children?.length ?? 0) : undefined,
  };
}

export interface NormalizeOptions {
  projectId: string;
  fileKey: string;
  /** Only these top-level frames are converted. Omit to take every frame. */
  frameIds?: string[];
  /** Nodes smaller than this in both axes are dropped as decoration. */
  minSize?: number;
}

export interface NormalizeResult {
  document: DesignDocument;
  /** Per-node detection reasons, kept for the review UI and training data. */
  reasons: Record<string, string>;
  stats: { nodesRead: number; nodesKept: number; framesConverted: number };
}

/** Figma marks hidden layers; they must not reach the generated code. */
function isVisible(node: FigmaNode): boolean {
  return node.visible !== false;
}

export function normalizeFigmaFile(file: FigmaFileResponse, options: NormalizeOptions): NormalizeResult {
  const { projectId, fileKey, frameIds, minSize = 2 } = options;

  const nodes: Record<string, IrNode> = {};
  const reasons: Record<string, string> = {};
  const frames: IrFrame[] = [];
  let nodesRead = 0;

  const pages = (file.document.children ?? []).filter(isVisible);

  for (const page of pages) {
    const topLevel = (page.children ?? []).filter(
      (frame) => isVisible(frame) && (!frameIds || frameIds.includes(frame.id)),
    );

    for (const frame of topLevel) {
      const frameWidth = frame.absoluteBoundingBox?.width ?? 0;

      // Two passes: build the tree, then classify. Detection needs a node's
      // children to already exist in IR form.
      const visit = (node: FigmaNode, parent: FigmaNode | null, parentId: string | null, depth: number, order: number): string | null => {
        nodesRead += 1;
        if (!isVisible(node)) return null;

        const box = relativeBox(node, parent);
        const isRoot = parentId === null;
        if (!isRoot && box.width < minSize && box.height < minSize) return null;

        const id = node.id;
        const type = isImageNode(node) ? "image" : mapType(node.type);

        const childIds: string[] = [];
        (node.children ?? []).forEach((child, index) => {
          const childId = visit(child, node, id, depth + 1, index);
          if (childId) childIds.push(childId);
        });

        const borderRadius =
          node.cornerRadius ??
          (node.rectangleCornerRadii ? Math.max(...node.rectangleCornerRadii) : undefined);

        nodes[id] = {
          id,
          type,
          name: node.name,
          sourceNodeId: node.id,
          parentId,
          childIds,
          orderIndex: order,
          depth,
          box,
          layout: buildLayout(node),
          style: {
            backgroundColor: paintToCss(node.fills) ?? undefined,
            borderColor: paintToCss(node.strokes) ?? undefined,
            borderWidth: node.strokeWeight,
            borderRadius,
            opacity: node.opacity,
            effects: mapEffects(node),
          },
          typography:
            node.type === "TEXT" && node.style
              ? {
                  fontFamily: node.style.fontFamily ?? "Inter",
                  fontSize: node.style.fontSize ?? 16,
                  fontWeight: node.style.fontWeight ?? 400,
                  lineHeight: node.style.lineHeightPx ?? (node.style.fontSize ?? 16) * 1.5,
                  letterSpacing: node.style.letterSpacing ?? 0,
                  color: paintToCss(node.fills) ?? "#000000",
                  textAlign:
                    node.style.textAlignHorizontal === "CENTER" ? "center"
                    : node.style.textAlignHorizontal === "RIGHT" ? "right"
                    : node.style.textAlignHorizontal === "JUSTIFIED" ? "justify"
                    : "left",
                }
              : undefined,
          textContent: node.characters,
          constraints: mapConstraints(node),
          interactions: [],
          componentId: node.componentId,
        };

        return id;
      };

      const rootId = visit(frame, null, null, 0, frames.length);
      if (!rootId) continue;

      frames.push({
        id: frame.id,
        name: frame.name,
        width: frame.absoluteBoundingBox?.width ?? 0,
        height: frame.absoluteBoundingBox?.height ?? 0,
        breakpoint: inferBreakpoint(frame.absoluteBoundingBox?.width ?? 0),
        rootNodeId: rootId,
      });

      // Classification pass, now that every node exists.
      for (const node of Object.values(nodes)) {
        if (node.semanticRole !== undefined) continue;
        const children = node.childIds.map((childId) => nodes[childId]).filter(Boolean);
        const detection = detectRole({ node, children, frameWidth });
        node.semanticRole = detection.role;
        node.confidence = detection.confidence || undefined;
        if (detection.role) reasons[node.id] = detection.reason;
      }
    }
  }

  const document: DesignDocument = {
    projectId,
    sourceFileKey: fileKey,
    name: file.name,
    version: file.version,
    frames,
    nodes,
    tokens: extractTokens(nodes),
    components: [],
    assets: [],
  };

  inferResponsive(document);

  return {
    document,
    reasons,
    stats: { nodesRead, nodesKept: Object.keys(nodes).length, framesConverted: frames.length },
  };
}

/** Maps a frame width onto the nearest standard breakpoint. */
export function inferBreakpoint(width: number): number | undefined {
  if (width <= 0) return undefined;
  if (width <= 480) return 390;
  if (width <= 1024) return 768;
  if (width <= 1366) return 1280;
  return 1440;
}
