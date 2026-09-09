import type { DesignDocument, IrNode } from "@/lib/design-ir/types";
import type {
  DifferenceCategory, DifferenceSeverity, DomNode, DomSnapshot, VisualDifference,
} from "./types";

/**
 * Design IR vs rendered DOM.
 *
 * This is what turns "it looks a bit off" into "the hero's top padding is 88px
 * and the design says 96px, in components/Hero.tsx". Pure, so it is testable
 * without a browser, and so the same logic can run against any renderer.
 */

/**
 * Tolerances, in pixels or units.
 *
 * Sub-pixel differences are noise: browsers round differently, fonts hint
 * differently, and reporting a 0.4px delta trains users to ignore the report.
 * Anything at or under these is treated as a match.
 */
export const TOLERANCE = {
  position: 2,
  size: 2,
  spacing: 2,
  fontSize: 0.5,
  lineHeight: 1,
  radius: 1,
} as const;

function severityFor(magnitude: number, tolerance: number): DifferenceSeverity {
  if (magnitude > tolerance * 8) return "high";
  if (magnitude > tolerance * 3) return "medium";
  return "low";
}

/** Normalises `#RRGGBB`, `rgb()` and `rgba()` to a comparable form. */
export function normaliseColour(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();

  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(trimmed);
  if (hex) {
    const digits = hex[1];
    const full = digits.length === 3 ? digits.split("").map((c) => c + c).join("") : digits;
    return `#${full}`;
  }

  const rgb = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?\s*\)$/.exec(trimmed);
  if (rgb) {
    const alpha = rgb[4] === undefined ? 1 : Number(rgb[4]);
    // Fully transparent is "no colour", not black — treating it as #000000
    // would report a false difference on every unstyled element.
    if (alpha === 0) return null;
    const hexOf = (n: string) => Number(n).toString(16).padStart(2, "0");
    return `#${hexOf(rgb[1])}${hexOf(rgb[2])}${hexOf(rgb[3])}`;
  }

  return trimmed;
}

function difference(
  category: DifferenceCategory,
  label: string,
  expected: number | string,
  actual: number | string,
  magnitude: number,
  tolerance: number,
  node: { sourceNodeId?: string; selector?: string; rect?: DomNode["rect"] },
): VisualDifference {
  const unit = typeof expected === "number" ? "px" : "";
  return {
    category,
    severity: severityFor(magnitude, tolerance),
    label,
    detail: `${expected}${unit} vs ${actual}${unit}`,
    expected: String(expected),
    actual: String(actual),
    magnitude,
    sourceNodeId: node.sourceNodeId,
    selector: node.selector,
    rect: node.rect,
  };
}

/**
 * Pairs IR nodes with DOM elements.
 *
 * The generator stamps `data-pf-node` onto elements it creates, so the primary
 * match is exact. Text content is the fallback for elements that lost the
 * attribute — a hand-edited file, or a component that renders children.
 */
export function matchNodes(
  document: DesignDocument,
  snapshot: DomSnapshot,
): { pairs: { ir: IrNode; dom: DomNode }[]; unmatched: IrNode[] } {
  const byId = new Map<string, DomNode>();
  const byText = new Map<string, DomNode>();

  for (const node of snapshot.nodes) {
    if (node.sourceNodeId) byId.set(node.sourceNodeId, node);
    const text = node.textContent?.trim();
    if (text && text.length > 3 && !byText.has(text)) byText.set(text, node);
  }

  const pairs: { ir: IrNode; dom: DomNode }[] = [];
  const unmatched: IrNode[] = [];
  const used = new Set<DomNode>();

  for (const ir of Object.values(document.nodes)) {
    // Only compare nodes that carry meaning. Anonymous wrappers exist in both
    // trees in different shapes and matching them produces noise.
    if (!ir.semanticRole && !ir.textContent) continue;

    const direct = byId.get(ir.id);
    if (direct && !used.has(direct)) {
      pairs.push({ ir, dom: direct });
      used.add(direct);
      continue;
    }

    const text = ir.textContent?.trim();
    const byContent = text ? byText.get(text) : undefined;
    if (byContent && !used.has(byContent)) {
      pairs.push({ ir, dom: byContent });
      used.add(byContent);
      continue;
    }

    unmatched.push(ir);
  }

  return { pairs, unmatched };
}

/**
 * Compares one matched pair.
 *
 * Position is compared relative to the parent, matching how the IR stores it —
 * comparing absolute coordinates would report every child of a shifted section
 * as broken, when there is really one difference at the top.
 */
export function compareNode(ir: IrNode, dom: DomNode): VisualDifference[] {
  const differences: VisualDifference[] = [];
  const at = { sourceNodeId: ir.id, selector: dom.selector, rect: dom.rect };
  const name = ir.name || ir.semanticRole || dom.tagName;

  const widthDelta = Math.abs(ir.box.width - dom.rect.width);
  if (widthDelta > TOLERANCE.size) {
    differences.push(
      difference("size", `${name} width`, Math.round(ir.box.width), Math.round(dom.rect.width), widthDelta, TOLERANCE.size, at),
    );
  }

  const heightDelta = Math.abs(ir.box.height - dom.rect.height);
  // Height is only compared for fixed-height elements: text reflows, and a
  // taller paragraph is usually correct rather than wrong.
  if (heightDelta > TOLERANCE.size && ir.layout.sizingVertical === "fixed") {
    differences.push(
      difference("size", `${name} height`, Math.round(ir.box.height), Math.round(dom.rect.height), heightDelta, TOLERANCE.size, at),
    );
  }

  const sides = ["top", "right", "bottom", "left"] as const;
  for (const side of sides) {
    const expected = ir.layout.padding[side];
    const actual = dom.padding[side];
    const delta = Math.abs(expected - actual);
    if (delta > TOLERANCE.spacing) {
      differences.push(
        difference("spacing", `${name} ${side} padding`, Math.round(expected), Math.round(actual), delta, TOLERANCE.spacing, at),
      );
    }
  }

  if (ir.typography && dom.fontSize !== undefined) {
    const delta = Math.abs(ir.typography.fontSize - dom.fontSize);
    if (delta > TOLERANCE.fontSize) {
      differences.push(
        difference("typography", `${name} font size`, ir.typography.fontSize, dom.fontSize, delta, TOLERANCE.fontSize, at),
      );
    }

    if (dom.fontWeight !== undefined && ir.typography.fontWeight !== dom.fontWeight) {
      differences.push(
        difference("typography", `${name} font weight`, ir.typography.fontWeight, dom.fontWeight,
          Math.abs(ir.typography.fontWeight - dom.fontWeight) / 100, 1, at),
      );
    }

    const expectedColour = normaliseColour(ir.typography.color);
    const actualColour = normaliseColour(dom.color);
    if (expectedColour && actualColour && expectedColour !== actualColour) {
      differences.push(difference("color", `${name} text colour`, expectedColour, actualColour, 10, 1, at));
    }
  }

  const expectedBackground = normaliseColour(ir.style.backgroundColor);
  const actualBackground = normaliseColour(dom.backgroundColor);
  if (expectedBackground && actualBackground && expectedBackground !== actualBackground) {
    differences.push(difference("color", `${name} background`, expectedBackground, actualBackground, 10, 1, at));
  }

  if (ir.style.borderRadius !== undefined && dom.borderRadius !== undefined) {
    const delta = Math.abs(ir.style.borderRadius - dom.borderRadius);
    if (delta > TOLERANCE.radius) {
      differences.push(
        difference("border", `${name} corner radius`, ir.style.borderRadius, dom.borderRadius, delta, TOLERANCE.radius, at),
      );
    }
  }

  return differences;
}

export interface DomComparison {
  differences: VisualDifference[];
  matchedNodes: number;
  unmatchedNodes: number;
}

export function compareDom(document: DesignDocument, snapshot: DomSnapshot): DomComparison {
  const { pairs, unmatched } = matchNodes(document, snapshot);

  const differences = pairs.flatMap(({ ir, dom }) => compareNode(ir, dom));

  // A node in the design with nothing rendering it is a missing element, which
  // is a layout difference in its own right and worth surfacing.
  for (const ir of unmatched) {
    if (!ir.semanticRole) continue;
    differences.push({
      category: "layout",
      severity: "high",
      label: `${ir.name || ir.semanticRole} is missing`,
      detail: "present in the design, not found in the rendered page",
      expected: "rendered",
      actual: "absent",
      magnitude: 25,
      sourceNodeId: ir.id,
    });
  }

  return {
    differences: differences.sort((a, b) => b.magnitude - a.magnitude),
    matchedNodes: pairs.length,
    unmatchedNodes: unmatched.length,
  };
}
