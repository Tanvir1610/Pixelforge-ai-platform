import { describe, expect, it } from "vitest";
import { compactDocument, compactTokens } from "@/lib/ai/context/compact";
import { normalizeFigmaFile } from "@/lib/figma/normalize";
import { FILE } from "./fixtures/figma-file";
import type { DesignDocument, IrNode } from "@/lib/design-ir/types";

const { document } = normalizeFigmaFile(FILE, { projectId: "p1", fileKey: "8kQ2" });

describe("compactDocument", () => {
  it("includes the design's identity and frames", () => {
    const result = compactDocument(document);
    expect(result.text).toContain("Northwind");
    expect(result.text).toContain("1440x1000");
  });

  it("emits node ids the agent can reference back", () => {
    const result = compactDocument(document);
    for (const id of result.includedIds) {
      expect(result.text).toContain(`#${id}`);
    }
  });

  it("carries detected roles and confidence into the prompt", () => {
    const text = compactDocument(document).text;
    expect(text).toMatch(/role=navbar@\d+/);
    expect(text).toMatch(/role=hero@\d+/);
  });

  it("includes layout and typography, which the model reasons over", () => {
    const text = compactDocument(document).text;
    expect(text).toContain("layout=horizontal");
    expect(text).toContain("pad=");
    expect(text).toMatch(/font=64\/800/);
  });

  // Budgeting is the whole point: a real file must not blow the context window.
  it("respects a tight token budget and says it truncated", () => {
    const result = compactDocument(document, { maxTokens: 200 });
    expect(result.estimatedTokens).toBeLessThanOrEqual(400);
    expect(result.truncated).toBe(true);
    expect(result.includedIds.length).toBeLessThan(Object.keys(document.nodes).length);
  });

  it("keeps structural nodes when the budget forces a choice", () => {
    const result = compactDocument(document, { maxTokens: 260 });
    // The hero is structural; a nested card label is not.
    expect(result.includedIds).toContain("1:7");
  });

  it("prefers low-confidence nodes, which are what need a second opinion", () => {
    const nodes: Record<string, IrNode> = {};
    const base = (id: string, confidence: number): IrNode => ({
      id, type: "container", name: `Node ${id}`, parentId: "root", childIds: [],
      orderIndex: 0, depth: 3,
      box: { x: 0, y: 0, width: 100, height: 100 },
      layout: { mode: "none", gap: 0, padding: { top: 0, right: 0, bottom: 0, left: 0 }, sizingHorizontal: "fixed", sizingVertical: "hug" },
      style: { effects: [] }, interactions: [], semanticRole: "card", confidence,
    });
    nodes.root = { ...base("root", 99), parentId: null, depth: 0, childIds: ["sure", "unsure"] };
    nodes.sure = base("sure", 99);
    nodes.unsure = base("unsure", 40);

    const doc: DesignDocument = {
      ...document, nodes,
      frames: [{ id: "f", name: "F", width: 1440, height: 1000, rootNodeId: "root" }],
    };

    // The invariant, rather than a guessed byte budget: at no budget should a
    // confident node survive while an uncertain one is dropped.
    for (const budget of [120, 160, 200, 260, 400, 800]) {
      const result = compactDocument(doc, { maxTokens: budget });
      const included = new Set(result.includedIds);
      if (included.has("sure")) expect(included.has("unsure")).toBe(true);
    }

    const generous = compactDocument(doc, { maxTokens: 4000 });
    expect(generous.includedIds).toContain("unsure");
  });

  it("reports how many nodes it left out", () => {
    const result = compactDocument(document, { maxTokens: 300 });
    expect(result.text).toMatch(/further leaf nodes omitted/);
  });

  it("is deterministic, so evaluation runs are comparable", () => {
    expect(compactDocument(document).text).toBe(compactDocument(document).text);
  });

  it("lists nodes in document order once selection is done", () => {
    const result = compactDocument(document);
    const navbarAt = result.text.indexOf("#1:3");
    const gridAt = result.text.indexOf("#1:12");
    expect(navbarAt).toBeGreaterThan(-1);
    expect(navbarAt).toBeLessThan(gridAt);
  });
});

describe("compactTokens", () => {
  it("groups extracted tokens by category with usage counts", () => {
    const text = compactTokens(document);
    expect(text).toContain("COLOR:");
    expect(text).toMatch(/\(\d+x\)/);
  });

  it("says so plainly when there is nothing to report", () => {
    expect(compactTokens({ ...document, tokens: [] })).toBe("TOKENS: none extracted");
  });
});
