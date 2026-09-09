import type { IrNode, SemanticRole } from "@/lib/design-ir/types";

/**
 * Semantic role detection.
 *
 * Two signals, combined: what the designer named the layer, and what the node
 * structurally looks like. Names are the stronger signal when present — a frame
 * called "Hero" almost certainly is one — but they are absent or wrong often
 * enough that shape has to carry the result on its own.
 *
 * Every result carries a confidence. Anything under 85 is surfaced for review
 * before code generation, because correcting a mapping there costs far less
 * than a refinement pass afterwards.
 */

interface Rule {
  role: SemanticRole;
  /** Matched against the lowercased layer name. */
  namePattern: RegExp;
  /** Confidence when the name matches. */
  nameConfidence: number;
}

const NAME_RULES: Rule[] = [
  { role: "navbar", namePattern: /\b(nav(bar|igation)?|header|topbar|menu ?bar)\b/, nameConfidence: 97 },
  { role: "hero", namePattern: /\b(hero|masthead|banner|jumbotron)\b/, nameConfidence: 96 },
  { role: "footer", namePattern: /\bfooter\b/, nameConfidence: 97 },
  { role: "sidebar", namePattern: /\b(sidebar|side ?nav|rail)\b/, nameConfidence: 95 },
  { role: "pricing_section", namePattern: /\bpricing\b/, nameConfidence: 92 },
  { role: "pricing_plan", namePattern: /\b(plan|tier)\b/, nameConfidence: 88 },
  { role: "testimonial", namePattern: /\b(testimonial|quote|review)\b/, nameConfidence: 90 },
  // Ordered before feature_grid: "Feature card" must not match the grid rule.
  { role: "feature_card", namePattern: /\b(feature|benefit)s? ?card\b/, nameConfidence: 92 },
  // The suffix is required — a bare "Features" is too weak a signal on its own.
  { role: "feature_grid", namePattern: /\b(features?|benefits?) ?(grid|list|section|row)\b/, nameConfidence: 88 },
  { role: "cta", namePattern: /\b(cta|call ?to ?action)\b/, nameConfidence: 93 },
  { role: "button", namePattern: /\b(button|btn)\b/, nameConfidence: 96 },
  { role: "input", namePattern: /\b(input|field|text ?box|search ?bar)\b/, nameConfidence: 93 },
  { role: "form", namePattern: /\bform\b/, nameConfidence: 90 },
  { role: "modal", namePattern: /\b(modal|dialog|popup|overlay)\b/, nameConfidence: 92 },
  { role: "table", namePattern: /\btable\b/, nameConfidence: 92 },
  { role: "tabs", namePattern: /\btabs?\b/, nameConfidence: 88 },
  { role: "badge", namePattern: /\b(badge|chip|pill|tag)\b/, nameConfidence: 90 },
  { role: "avatar", namePattern: /\b(avatar|profile ?(pic|image))\b/, nameConfidence: 92 },
  { role: "logo", namePattern: /\b(logo|wordmark|brandmark)\b/, nameConfidence: 94 },
  { role: "card", namePattern: /\bcard\b/, nameConfidence: 88 },
  { role: "icon", namePattern: /\bicons?\b/, nameConfidence: 90 },
];

export interface DetectionInput {
  node: IrNode;
  /** Direct children, needed for structural signals. */
  children: IrNode[];
  /** Width of the frame this node lives in, for full-bleed detection. */
  frameWidth: number;
}

export interface Detection {
  role: SemanticRole | undefined;
  confidence: number;
  /** Why we decided this. Shown in the review UI and kept for training data. */
  reason: string;
}

function detectByName(name: string): Detection | null {
  const normalised = name.toLowerCase().replace(/[_/]+/g, " ");
  for (const rule of NAME_RULES) {
    if (rule.namePattern.test(normalised)) {
      return { role: rule.role, confidence: rule.nameConfidence, reason: `layer named "${name}"` };
    }
  }
  return null;
}

/**
 * Structural detection, used when the name says nothing.
 *
 * Confidence is capped lower than name matches on purpose: shape alone is
 * suggestive, not conclusive.
 */
function detectByShape({ node, children, frameWidth }: DetectionInput): Detection | null {
  const { box, layout } = node;
  const fullBleed = frameWidth > 0 && box.width >= frameWidth * 0.9;
  const atTop = box.y <= 24;

  if (node.type === "text") {
    const size = node.typography?.fontSize ?? 0;
    if (size >= 32) return { role: "heading", confidence: 88, reason: `text at ${size}px` };
    return { role: "paragraph", confidence: 80, reason: "body text" };
  }

  if (fullBleed && atTop && layout.mode === "horizontal" && box.height <= 120) {
    return { role: "navbar", confidence: 84, reason: "full-width horizontal band at the top of the frame" };
  }

  if (fullBleed && atTop && box.height >= 300) {
    return { role: "hero", confidence: 82, reason: "first full-width section, taller than 300px" };
  }

  // Three or more same-width siblings in a row is a grid, whatever it is called.
  if (layout.mode === "horizontal" && children.length >= 3) {
    const widths = children.map((child) => child.box.width);
    const uniform = widths.every((width) => Math.abs(width - widths[0]) <= 2);
    if (uniform) {
      return { role: "feature_grid", confidence: 83, reason: `${children.length} equal-width children in a row` };
    }
  }

  // A small pill containing exactly one text node reads as a button.
  const textChildren = children.filter((child) => child.type === "text");
  if (
    children.length <= 2 &&
    textChildren.length === 1 &&
    box.height <= 64 &&
    box.width <= 320 &&
    (node.style.borderRadius ?? 0) >= 4 &&
    node.style.backgroundColor
  ) {
    return { role: "button", confidence: 81, reason: "small filled container wrapping a single label" };
  }

  if (layout.mode === "vertical" && (node.style.borderRadius ?? 0) >= 8 && children.length >= 2) {
    return { role: "card", confidence: 78, reason: "rounded vertical stack" };
  }

  return null;
}

/**
 * Detects a node's role. A name match wins; shape is the fallback. When both
 * agree, confidence is raised — independent signals agreeing is real evidence.
 */
export function detectRole(input: DetectionInput): Detection {
  const byName = detectByName(input.node.name);
  const byShape = detectByShape(input);

  if (byName && byShape && byName.role === byShape.role) {
    return {
      role: byName.role,
      confidence: Math.min(99, byName.confidence + 2),
      reason: `${byName.reason}; confirmed by ${byShape.reason}`,
    };
  }

  if (byName) return byName;
  if (byShape) return byShape;

  return { role: undefined, confidence: 0, reason: "no name or structural signal" };
}
