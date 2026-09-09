import { describe, expect, it } from "vitest";
import { inferBreakpoint, normalizeFigmaFile } from "@/lib/figma/normalize";
import { paintToCss, toHex } from "@/lib/figma/color";
import { walk, findByRole, lowConfidenceNodes } from "@/lib/design-ir/types";
import { FILE } from "./fixtures/figma-file";

const result = normalizeFigmaFile(FILE, { projectId: "p1", fileKey: "8kQ2" });
const { document } = result;

describe("colour conversion", () => {
  it("converts Figma's 0-1 channels to hex", () => {
    expect(toHex({ r: 1, g: 1, b: 1, a: 1 })).toBe("#FFFFFF");
    expect(toHex({ r: 0.388, g: 0.4, b: 0.945, a: 1 })).toBe("#6366F1");
  });

  it("uses rgba when the paint is translucent", () => {
    expect(paintToCss([{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 0.5 } }])).toBe("rgba(0, 0, 0, 0.5)");
  });

  it("ignores hidden paints", () => {
    expect(paintToCss([{ type: "SOLID", visible: false, color: { r: 1, g: 0, b: 0, a: 1 } }])).toBeNull();
  });

  // A gradient reported as a flat colour would poison the extracted tokens.
  it("returns null for gradients and image fills rather than guessing", () => {
    expect(paintToCss([{ type: "GRADIENT_LINEAR" }])).toBeNull();
    expect(paintToCss([{ type: "IMAGE", imageRef: "abc" }])).toBeNull();
    expect(paintToCss([])).toBeNull();
    expect(paintToCss(undefined)).toBeNull();
  });
});

describe("normalizeFigmaFile", () => {
  it("converts the top-level frame", () => {
    expect(document.frames).toHaveLength(1);
    expect(document.frames[0]).toMatchObject({ name: "Home / Desktop", width: 1440, breakpoint: 1440 });
  });

  it("carries file identity onto the document", () => {
    expect(document.name).toBe("Northwind");
    expect(document.version).toBe("3145");
    expect(document.sourceFileKey).toBe("8kQ2");
    expect(document.projectId).toBe("p1");
  });

  it("excludes hidden layers and their subtrees", () => {
    expect(document.nodes["1:16"]).toBeUndefined();
    expect(document.nodes["1:17"]).toBeUndefined();
  });

  it("drops negligible artifacts but keeps thin dividers", () => {
    expect(document.nodes["1:18"]).toBeUndefined();
  });

  it("converts absolute coordinates to parent-relative", () => {
    // The hero sits at absolute y=64 directly under the frame at y=0.
    expect(document.nodes["1:7"].box).toMatchObject({ x: 0, y: 64 });
    // Its heading is at absolute y=160, so 96 below the hero.
    expect(document.nodes["1:8"].box.y).toBe(96);
  });

  it("preserves the tree structure", () => {
    const root = document.frames[0].rootNodeId;
    expect(document.nodes[root].childIds).toEqual(["1:3", "1:7", "1:12"]);
    expect(document.nodes["1:8"].parentId).toBe("1:7");
    expect(document.nodes["1:8"].depth).toBe(2);
  });

  it("maps auto layout to the IR layout model", () => {
    expect(document.nodes["1:3"].layout).toMatchObject({
      mode: "horizontal", gap: 24, justifyContent: "between", alignItems: "center",
    });
    expect(document.nodes["1:7"].layout.padding).toEqual({ top: 96, right: 80, bottom: 96, left: 80 });
  });

  it("maps hug and fill sizing", () => {
    expect(document.nodes["1:13"].layout.sizingHorizontal).toBe("fill");
    expect(document.nodes["1:13"].layout.sizingVertical).toBe("hug");
  });

  it("extracts typography from text nodes only", () => {
    expect(document.nodes["1:8"].typography).toMatchObject({ fontSize: 64, fontWeight: 800, fontFamily: "Inter" });
    expect(document.nodes["1:8"].textContent).toBe("Ship your ideas without the rebuild.");
    expect(document.nodes["1:3"].typography).toBeUndefined();
  });

  it("maps style, radius and effects", () => {
    const card = document.nodes["1:13"];
    expect(card.style.backgroundColor).toBe("#FFFFFF");
    expect(card.style.borderRadius).toBe(12);
    expect(card.style.borderWidth).toBe(1);
    expect(card.style.effects[0]).toMatchObject({ type: "drop_shadow", blur: 12, y: 4 });
  });

  it("maps constraints", () => {
    expect(document.nodes["1:3"].constraints).toEqual({ horizontal: "stretch", vertical: "top" });
  });

  it("reports what it read versus what it kept", () => {
    expect(result.stats.framesConverted).toBe(1);
    expect(result.stats.nodesKept).toBeLessThan(result.stats.nodesRead);
    expect(result.stats.nodesKept).toBe(Object.keys(document.nodes).length);
  });

  it("produces a walkable tree", () => {
    const ids = [...walk(document, document.frames[0].rootNodeId)].map((node) => node.id);
    expect(ids[0]).toBe("1:2");
    expect(ids).toContain("1:11");
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("semantic detection", () => {
  it("identifies the navbar, hero and cards by name", () => {
    expect(document.nodes["1:3"].semanticRole).toBe("navbar");
    expect(document.nodes["1:7"].semanticRole).toBe("hero");
    expect(document.nodes["1:13"].semanticRole).toBe("feature_card");
  });

  it("identifies a large text node as a heading without a naming hint", () => {
    expect(document.nodes["1:8"].semanticRole).toBe("heading");
  });

  it("identifies the equal-width row as a grid from shape alone", () => {
    // The layer is called "Grid", which no name rule matches; shape decides.
    expect(document.nodes["1:12"].semanticRole).toBe("feature_grid");
  });

  it("identifies a filled pill wrapping one label as a button", () => {
    expect(document.nodes["1:10"].semanticRole).toBe("button");
  });

  it("attaches a confidence to every classified node", () => {
    for (const node of findByRole(document, "navbar")) {
      expect(node.confidence).toBeGreaterThan(0);
    }
  });

  it("records why each decision was made", () => {
    expect(result.reasons["1:12"]).toContain("equal-width");
    expect(result.reasons["1:3"]).toContain("Navbar");
  });

  it("flags uncertain nodes for review rather than hiding them", () => {
    const flagged = lowConfidenceNodes(document, 85);
    expect(flagged.every((node) => (node.confidence ?? 0) < 85)).toBe(true);
  });
});

describe("inferBreakpoint", () => {
  it("maps frame widths onto standard breakpoints", () => {
    expect(inferBreakpoint(1440)).toBe(1440);
    expect(inferBreakpoint(1280)).toBe(1280);
    expect(inferBreakpoint(768)).toBe(768);
    expect(inferBreakpoint(390)).toBe(390);
    expect(inferBreakpoint(1920)).toBe(1440);
  });

  it("returns nothing for a zero-width frame", () => {
    expect(inferBreakpoint(0)).toBeUndefined();
  });
});

describe("responsive inference", () => {
  it("collapses an equal-width row across breakpoints", () => {
    const hints = document.nodes["1:12"].responsiveHints;
    expect(hints?.columnsByBreakpoint).toMatchObject({ 1440: 3, 768: 2, 390: 1 });
  });

  it("scales display type down on narrow screens", () => {
    expect(document.nodes["1:8"].responsiveHints?.fontScaleByBreakpoint?.[390]).toBeLessThan(1);
  });

  it("hides the navbar link row below tablet", () => {
    expect(document.nodes["1:3"].responsiveHints?.hiddenBelowWidth).toBe(768);
  });
});
