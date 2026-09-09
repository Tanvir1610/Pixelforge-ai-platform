import { describe, expect, it } from "vitest";
import { compareDom, compareNode, matchNodes, normaliseColour, TOLERANCE } from "@/lib/visual/dom-compare";
import { buildComparison, overallSimilarity, prioritiseDifferences, scoreMetrics } from "@/lib/visual/score";
import { normalizeFigmaFile } from "@/lib/figma/normalize";
import { FILE } from "./fixtures/figma-file";
import type { DomNode, DomSnapshot, VisualDifference } from "@/lib/visual/types";
import type { IrNode } from "@/lib/design-ir/types";

const { document } = normalizeFigmaFile(FILE, { projectId: "p1", fileKey: "8kQ2" });

/** A DOM node that matches its IR counterpart exactly. */
function domFor(ir: IrNode, overrides: Partial<DomNode> = {}): DomNode {
  return {
    sourceNodeId: ir.id,
    selector: `div.${ir.name.toLowerCase().replace(/\s+/g, "-")}`,
    tagName: "div",
    rect: { x: ir.box.x, y: ir.box.y, width: ir.box.width, height: ir.box.height },
    padding: { ...ir.layout.padding },
    fontSize: ir.typography?.fontSize,
    fontWeight: ir.typography?.fontWeight,
    color: ir.typography?.color,
    backgroundColor: ir.style.backgroundColor,
    borderRadius: ir.style.borderRadius,
    textContent: ir.textContent,
    ...overrides,
  };
}

function snapshot(nodes: DomNode[], breakpoint = 1440): DomSnapshot {
  return { breakpoint, viewport: { width: breakpoint, height: 1000 }, nodes };
}

describe("normaliseColour", () => {
  it("brings hex, rgb and rgba to one form", () => {
    expect(normaliseColour("#6366F1")).toBe("#6366f1");
    expect(normaliseColour("rgb(99, 102, 241)")).toBe("#6366f1");
    expect(normaliseColour("rgba(99, 102, 241, 1)")).toBe("#6366f1");
    expect(normaliseColour("#fff")).toBe("#ffffff");
  });

  /** Treating transparent as black would report a false difference on every
   *  unstyled element, which is most of them. */
  it("treats fully transparent as no colour", () => {
    expect(normaliseColour("rgba(0, 0, 0, 0)")).toBeNull();
    expect(normaliseColour(undefined)).toBeNull();
  });
});

describe("matchNodes", () => {
  it("pairs by the generator's node attribute", () => {
    const hero = document.nodes["1:7"];
    const { pairs } = matchNodes(document, snapshot([domFor(hero)]));

    expect(pairs).toHaveLength(1);
    expect(pairs[0].ir.id).toBe("1:7");
  });

  it("falls back to text content when the attribute is missing", () => {
    const heading = document.nodes["1:8"];
    const { pairs } = matchNodes(
      document,
      snapshot([domFor(heading, { sourceNodeId: undefined })]),
    );

    expect(pairs.some((pair) => pair.ir.id === "1:8")).toBe(true);
  });

  it("reports design nodes with nothing rendering them", () => {
    const { unmatched } = matchNodes(document, snapshot([]));
    expect(unmatched.length).toBeGreaterThan(0);
    expect(unmatched.some((node) => node.semanticRole === "hero")).toBe(true);
  });

  it("does not reuse one element for two design nodes", () => {
    const hero = document.nodes["1:7"];
    const { pairs } = matchNodes(document, snapshot([domFor(hero), domFor(hero)]));
    const ids = pairs.map((pair) => pair.ir.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("compareNode", () => {
  const hero = document.nodes["1:7"];

  it("finds nothing when the render matches", () => {
    expect(compareNode(hero, domFor(hero))).toEqual([]);
  });

  /** The headline capability: a real number, not "these look different". */
  it("reports a padding difference with both values", () => {
    const dom = domFor(hero, { padding: { ...hero.layout.padding, top: 88 } });
    const differences = compareNode(hero, dom);

    const padding = differences.find((difference) => difference.category === "spacing");
    expect(padding).toBeDefined();
    expect(padding?.detail).toBe("96px vs 88px");
    expect(padding?.expected).toBe("96");
    expect(padding?.actual).toBe("88");
    expect(padding?.sourceNodeId).toBe("1:7");
  });

  it("ignores sub-pixel noise", () => {
    const dom = domFor(hero, { rect: { ...hero.box, width: hero.box.width + TOLERANCE.size - 0.5 } });
    expect(compareNode(hero, dom)).toEqual([]);
  });

  it("scales severity with the size of the difference", () => {
    const small = compareNode(hero, domFor(hero, { padding: { ...hero.layout.padding, top: 90 } }));
    const large = compareNode(hero, domFor(hero, { padding: { ...hero.layout.padding, top: 20 } }));

    expect(small[0].severity).toBe("low");
    expect(large[0].severity).toBe("high");
  });

  it("reports font size and weight separately", () => {
    const heading = document.nodes["1:8"];
    const differences = compareNode(heading, domFor(heading, { fontSize: 48, fontWeight: 400 }));

    const labels = differences.map((difference) => difference.label);
    expect(labels.some((label) => label.includes("font size"))).toBe(true);
    expect(labels.some((label) => label.includes("font weight"))).toBe(true);
  });

  it("compares colours across notations", () => {
    const button = document.nodes["1:10"];
    // Same colour, written the way a browser reports it.
    expect(compareNode(button, domFor(button, { backgroundColor: "rgb(99, 102, 241)" }))).toEqual([]);

    const wrong = compareNode(button, domFor(button, { backgroundColor: "rgb(255, 0, 0)" }));
    expect(wrong.some((difference) => difference.category === "color")).toBe(true);
  });

  /** Text reflows; a taller paragraph is usually correct, not broken. */
  it("does not report height for hug-sized elements", () => {
    const card = document.nodes["1:13"];
    const differences = compareNode(card, domFor(card, {
      rect: { ...card.box, height: card.box.height + 60 },
    }));
    expect(differences.every((difference) => !difference.label.includes("height"))).toBe(true);
  });
});

describe("compareDom", () => {
  it("flags a missing section as a high-severity layout problem", () => {
    const result = compareDom(document, snapshot([]));
    const missing = result.differences.find((difference) => difference.label.includes("missing"));

    expect(missing?.severity).toBe("high");
    expect(missing?.category).toBe("layout");
  });

  it("returns a clean result for a faithful render", () => {
    const nodes = Object.values(document.nodes)
      .filter((node) => node.semanticRole || node.textContent)
      .map((node) => domFor(node));

    const result = compareDom(document, snapshot(nodes));

    expect(result.differences).toEqual([]);
    expect(result.matchedNodes).toBeGreaterThan(0);
    expect(result.unmatchedNodes).toBe(0);
  });

  it("orders differences by magnitude", () => {
    const nodes = Object.values(document.nodes)
      .filter((node) => node.semanticRole || node.textContent)
      .map((node) =>
        node.id === "1:7"
          ? domFor(node, { padding: { ...node.layout.padding, top: 10 } })
          : domFor(node, { padding: { ...node.layout.padding, top: node.layout.padding.top + 4 } }),
      );

    const result = compareDom(document, snapshot(nodes));
    for (let index = 1; index < result.differences.length; index += 1) {
      expect(result.differences[index - 1].magnitude).toBeGreaterThanOrEqual(result.differences[index].magnitude);
    }
  });
});

function difference(overrides: Partial<VisualDifference> = {}): VisualDifference {
  return {
    category: "spacing", severity: "medium", label: "x", detail: "1 vs 2",
    expected: "1", actual: "2", magnitude: 4, ...overrides,
  };
}

describe("scoring", () => {
  it("scores a perfect match at 100 across the board", () => {
    const metrics = scoreMetrics([], 50);
    expect(metrics).toEqual({ spacing: 100, typography: 100, color: 100, layout: 100, components: 100 });
    expect(overallSimilarity(metrics)).toBe(100);
  });

  /** Showing 100% beside a list of problems destroys trust in every number. */
  it("never reports 100 when a difference exists", () => {
    const metrics = scoreMetrics([difference({ severity: "low" })], 200);
    expect(metrics.spacing).toBeLessThan(100);
  });

  it("penalises severity, not just count", () => {
    const light = scoreMetrics([difference({ severity: "low" })], 50).spacing;
    const heavy = scoreMetrics([difference({ severity: "high" })], 50).spacing;
    expect(heavy).toBeLessThan(light);
  });

  it("keeps a category clean when its problems are elsewhere", () => {
    const metrics = scoreMetrics([difference({ category: "typography" })], 50);
    expect(metrics.spacing).toBe(100);
    expect(metrics.typography).toBeLessThan(100);
  });

  it("normalises by page size", () => {
    const differences = Array.from({ length: 5 }, () => difference());
    expect(scoreMetrics(differences, 400).spacing).toBeGreaterThan(scoreMetrics(differences, 12).spacing);
  });

  it("weights layout above colour in the overall score", () => {
    const layoutBroken = overallSimilarity({ spacing: 100, typography: 100, color: 100, layout: 50, components: 100 });
    const colourBroken = overallSimilarity({ spacing: 100, typography: 100, color: 50, layout: 100, components: 100 });
    expect(layoutBroken).toBeLessThan(colourBroken);
  });

  it("blends in the pixel delta when one was measured", () => {
    const metrics = { spacing: 100, typography: 100, color: 100, layout: 100, components: 100 };
    expect(overallSimilarity(metrics, 0.2)).toBeLessThan(overallSimilarity(metrics));
  });

  it("never returns a negative score", () => {
    const many = Array.from({ length: 300 }, () => difference({ severity: "high" }));
    const metrics = scoreMetrics(many, 5);
    expect(Math.min(...Object.values(metrics))).toBeGreaterThanOrEqual(0);
  });

  it("assembles a comparison result", () => {
    const result = buildComparison({
      breakpoint: 1440,
      differences: [difference()],
      matchedNodes: 40,
      unmatchedNodes: 1,
      pixelDelta: 0.01,
    });

    expect(result.breakpoint).toBe(1440);
    expect(result.similarity).toBeGreaterThan(80);
    expect(result.similarity).toBeLessThan(100);
  });
});

describe("prioritiseDifferences", () => {
  it("puts high severity first, then magnitude", () => {
    const result = prioritiseDifferences([
      difference({ severity: "low", magnitude: 90 }),
      difference({ severity: "high", magnitude: 3 }),
      difference({ severity: "medium", magnitude: 50 }),
    ]);

    expect(result[0].severity).toBe("high");
    expect(result[1].severity).toBe("medium");
  });

  /** A repair prompt with eighty differences produces worse fixes than one
   *  with the ten that matter. */
  it("caps the list", () => {
    const many = Array.from({ length: 80 }, (_, index) => difference({ magnitude: index }));
    expect(prioritiseDifferences(many, 15)).toHaveLength(15);
  });
});
