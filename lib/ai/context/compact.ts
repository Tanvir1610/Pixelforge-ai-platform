import type { DesignDocument, IrNode } from "@/lib/design-ir/types";
import { estimateTokens } from "../models";

/**
 * Compacts a Design IR document into a text representation the model can read
 * inside a token budget.
 *
 * The whole document is never sent. A real marketing page is thousands of
 * nodes and most of them are leaf decoration that tells the model nothing it
 * cannot infer. §20: retrieve only relevant context.
 *
 * The compaction is deterministic, so the same design produces the same prompt —
 * which is what makes evaluation runs comparable and caching possible.
 */

export interface CompactOptions {
  /** Hard ceiling on the design portion of the prompt. */
  maxTokens?: number;
  /** Nodes deeper than this are summarised as a count rather than listed. */
  maxDepth?: number;
}

export interface CompactResult {
  text: string;
  /** Node ids actually included, so corrections can be mapped back. */
  includedIds: string[];
  estimatedTokens: number;
  truncated: boolean;
}

function round(value: number | undefined): string {
  if (value === undefined) return "-";
  return String(Math.round(value));
}

/**
 * Scores how much a node is worth spending context on.
 *
 * Structure beats decoration: containers that lay out other things, text that
 * carries meaning, and anything already classified with low confidence (which
 * is precisely what we want a second opinion on).
 */
function informationValue(node: IrNode): number {
  let score = 0;

  if (node.childIds.length > 0) score += 3 + Math.min(node.childIds.length, 6);
  if (node.layout.mode !== "none") score += 4;
  if (node.type === "text") score += 3;
  if (node.textContent) score += 2;
  if (node.semanticRole) score += 2;
  // An uncertain classification is the most useful thing to show the model.
  if (node.confidence !== undefined && node.confidence < 85) score += 6;
  // Big elements shape the page; 12px icons do not.
  if (node.box.height >= 200 || node.box.width >= 600) score += 2;
  // Shallow nodes are structural, deep ones are detail.
  score += Math.max(0, 6 - node.depth);

  return score;
}

/** One line per node, dense but readable. Attributes are omitted when default. */
function describe(node: IrNode, indent: number): string {
  const parts: string[] = [];

  parts.push(`${"  ".repeat(indent)}#${node.id} ${node.type}`);
  parts.push(`"${node.name.slice(0, 48)}"`);
  parts.push(`${round(node.box.width)}x${round(node.box.height)}`);

  if (node.layout.mode !== "none") {
    const { mode, gap, padding } = node.layout;
    parts.push(`layout=${mode}`);
    if (gap) parts.push(`gap=${gap}`);
    const pad = [padding.top, padding.right, padding.bottom, padding.left];
    if (pad.some((side) => side > 0)) parts.push(`pad=${pad.join("/")}`);
    if (node.layout.columns) parts.push(`cols=${node.layout.columns}`);
  }

  if (node.typography) {
    parts.push(`font=${node.typography.fontSize}/${node.typography.fontWeight}`);
  }
  if (node.style.borderRadius) parts.push(`radius=${node.style.borderRadius}`);
  if (node.style.backgroundColor) parts.push(`bg=${node.style.backgroundColor}`);

  if (node.semanticRole) {
    parts.push(`role=${node.semanticRole}${node.confidence ? `@${Math.round(node.confidence)}` : ""}`);
  }

  if (node.textContent) {
    const text = node.textContent.replace(/\s+/g, " ").slice(0, 80);
    parts.push(`text="${text}"`);
  }

  return parts.join(" ");
}

export function compactDocument(document: DesignDocument, options: CompactOptions = {}): CompactResult {
  const { maxTokens = 12_000, maxDepth = 6 } = options;

  const header = [
    `DESIGN: ${document.name} (version ${document.version})`,
    `FRAMES: ${document.frames.map((frame) => `${frame.name} ${frame.width}x${frame.height}`).join(", ")}`,
    `TOKENS: ${document.tokens.length} extracted`,
    "",
    "NODES (id, type, name, size, layout, style, detected role):",
  ].join("\n");

  // Rank first, then re-sort the survivors into document order. Ranking decides
  // what fits; document order is what makes the result readable to the model.
  const candidates = Object.values(document.nodes)
    .filter((node) => node.depth <= maxDepth)
    .map((node) => ({ node, value: informationValue(node) }))
    .sort((a, b) => b.value - a.value);

  const selected: IrNode[] = [];
  let used = estimateTokens(header);
  let truncated = false;

  for (const { node } of candidates) {
    const cost = estimateTokens(describe(node, 0));
    if (used + cost > maxTokens) {
      truncated = true;
      break;
    }
    selected.push(node);
    used += cost;
  }

  const order = new Map<string, number>();
  let index = 0;
  for (const frame of document.frames) {
    const stack = [frame.rootNodeId];
    while (stack.length) {
      const id = stack.shift();
      if (!id) continue;
      order.set(id, index++);
      const node = document.nodes[id];
      if (node) stack.unshift(...node.childIds);
    }
  }

  selected.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

  const lines = selected.map((node) => describe(node, Math.min(node.depth, 6)));
  const omitted = Object.keys(document.nodes).length - selected.length;
  const footer = omitted > 0 ? `\n(${omitted} further leaf nodes omitted as decoration)` : "";

  const text = `${header}\n${lines.join("\n")}${footer}`;

  return {
    text,
    includedIds: selected.map((node) => node.id),
    estimatedTokens: estimateTokens(text),
    truncated,
  };
}

/** Compact token summary, cheap enough to include in every call. */
export function compactTokens(document: DesignDocument): string {
  if (!document.tokens.length) return "TOKENS: none extracted";

  const byCategory = new Map<string, string[]>();
  for (const token of document.tokens) {
    const list = byCategory.get(token.category) ?? [];
    list.push(`${token.name}=${JSON.stringify(token.value)} (${token.usageCount}x)`);
    byCategory.set(token.category, list);
  }

  return [...byCategory.entries()]
    .map(([category, values]) => `${category.toUpperCase()}: ${values.join(", ")}`)
    .join("\n");
}
