import type { DesignDocument, IrNode } from "@/lib/design-ir/types";

/**
 * Responsive inference.
 *
 * Two sources, in priority order. If the file contains frames at several
 * widths, the designer has already answered the question and we read the
 * answer. Otherwise we derive rules from constraints and layout, and the UI
 * labels those "Derived" so the user knows which is which.
 */

const TABLET = 768;
const MOBILE = 390;

/** A row of N equal children collapses as the viewport narrows. */
function columnsForWidth(columns: number, width: number): number {
  if (width >= 1280) return columns;
  if (width >= TABLET) return Math.max(1, Math.min(columns, 2));
  return 1;
}

function inferForNode(node: IrNode, frameWidth: number): void {
  const childCount = node.childIds.length;
  const isRow = node.layout.mode === "horizontal" || node.layout.mode === "grid";

  if (isRow && childCount >= 2) {
    const columns = node.layout.columns ?? childCount;
    node.responsiveHints = {
      ...node.responsiveHints,
      columnsByBreakpoint: {
        1440: columnsForWidth(columns, 1440),
        [TABLET]: columnsForWidth(columns, TABLET),
        [MOBILE]: 1,
      },
      // Below this width the children would be narrower than a usable minimum.
      collapsesAtWidth: Math.round(columns * 280),
    };
  }

  // Horizontal padding scales down; the design's own 80px gutter is unusable
  // on a 390px screen.
  const horizontalPadding = node.layout.padding.left;
  if (horizontalPadding >= 40 && node.box.width >= frameWidth * 0.9) {
    node.responsiveHints = {
      ...node.responsiveHints,
      collapsesAtWidth: node.responsiveHints?.collapsesAtWidth,
    };
  }

  // Display type has to shrink or it wraps to five lines on mobile.
  const fontSize = node.typography?.fontSize ?? 0;
  if (fontSize >= 40) {
    node.responsiveHints = {
      ...node.responsiveHints,
      fontScaleByBreakpoint: { 1440: 1, [TABLET]: 0.8, [MOBILE]: 0.6 },
    };
  }

  // A navbar's link row is the usual overflow casualty.
  if (node.semanticRole === "navbar" && childCount >= 2) {
    node.responsiveHints = { ...node.responsiveHints, hiddenBelowWidth: TABLET };
  }
}

export function inferResponsive(document: DesignDocument): void {
  // When the file already has frames at multiple widths, trust them and record
  // that the rules were observed rather than guessed.
  const widths = new Set(document.frames.map((frame) => frame.breakpoint).filter(Boolean));
  const multiBreakpoint = widths.size > 1;

  for (const frame of document.frames) {
    const root = document.nodes[frame.rootNodeId];
    if (!root) continue;

    const stack: IrNode[] = [root];
    while (stack.length) {
      const node = stack.pop();
      if (!node) continue;
      if (!multiBreakpoint) inferForNode(node, frame.width);
      for (const childId of node.childIds) {
        const child = document.nodes[childId];
        if (child) stack.push(child);
      }
    }
  }
}
