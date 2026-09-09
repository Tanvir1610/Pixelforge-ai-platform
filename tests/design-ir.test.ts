import { describe, expect, it } from "vitest";
import { findByRole, lowConfidenceNodes, walk, type DesignDocument, type IrNode } from "@/lib/design-ir/types";

function node(id: string, parentId: string | null, childIds: string[], overrides: Partial<IrNode> = {}): IrNode {
  return {
    id, type: "container", name: id, parentId, childIds, orderIndex: 0, depth: 0,
    box: { x: 0, y: 0, width: 100, height: 100 },
    layout: {
      mode: "vertical", gap: 0,
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      sizingHorizontal: "fill", sizingVertical: "hug",
    },
    style: { effects: [] },
    interactions: [],
    ...overrides,
  };
}

const document: DesignDocument = {
  projectId: "p1", sourceFileKey: "abc", name: "Northwind", version: "1",
  frames: [{ id: "f1", name: "Home", width: 1440, height: 3820, rootNodeId: "root" }],
  nodes: {
    root: node("root", null, ["nav", "hero"], { depth: 0 }),
    nav: node("nav", "root", [], { depth: 1, semanticRole: "navbar", confidence: 99 }),
    hero: node("hero", "root", ["heading"], { depth: 1, semanticRole: "hero", confidence: 98 }),
    heading: node("heading", "hero", [], { depth: 2, type: "text", semanticRole: "heading", confidence: 72 }),
  },
  tokens: [], components: [], assets: [],
};

describe("Design IR traversal", () => {
  it("walks depth-first from the root", () => {
    expect([...walk(document, "root")].map((n) => n.id)).toEqual(["root", "nav", "hero", "heading"]);
  });

  it("yields nothing for an unknown root", () => {
    expect([...walk(document, "nope")]).toEqual([]);
  });

  it("finds nodes by semantic role", () => {
    expect(findByRole(document, "navbar").map((n) => n.id)).toEqual(["nav"]);
    expect(findByRole(document, "footer")).toEqual([]);
  });

  it("surfaces low-confidence nodes worst first", () => {
    const flagged = lowConfidenceNodes(document, 85);
    expect(flagged.map((n) => n.id)).toEqual(["heading"]);
  });

  it("returns nothing when every node clears the threshold", () => {
    expect(lowConfidenceNodes(document, 50)).toEqual([]);
  });
});
