import { describe, expect, it } from "vitest";
import { normalizeFigmaFile } from "@/lib/figma/normalize";
import { extractTokens } from "@/lib/figma/tokens";
import { FILE } from "./fixtures/figma-file";

const { document } = normalizeFigmaFile(FILE, { projectId: "p1", fileKey: "8kQ2" });
const tokens = document.tokens;
const byCategory = (category: string) => tokens.filter((token) => token.category === category);

describe("token extraction", () => {
  it("promotes repeated colours and ranks them by usage", () => {
    const colours = byCategory("color");
    expect(colours.length).toBeGreaterThan(0);
    expect(colours[0].name).toBe("colors.primary");
    for (let i = 1; i < colours.length; i += 1) {
      expect(colours[i - 1].usageCount).toBeGreaterThanOrEqual(colours[i].usageCount);
    }
  });

  // A one-off value is incidental, not a design decision.
  it("ignores values used only once", () => {
    expect(tokens.every((token) => token.usageCount >= 2)).toBe(true);
  });

  it("names the type scale in ascending size order", () => {
    const typography = byCategory("typography");
    const sizes = typography.map((token) => (token.value as { fontSize: number }).fontSize);
    expect([...sizes].sort((a, b) => a - b)).toEqual(sizes);
  });

  it("extracts spacing from gaps and padding, smallest first", () => {
    const spacing = byCategory("spacing").map((token) => token.value as number);
    expect(spacing.length).toBeGreaterThan(0);
    expect([...spacing].sort((a, b) => a - b)).toEqual(spacing);
  });

  it("extracts radius and shadow tokens", () => {
    expect(byCategory("radius").length).toBeGreaterThan(0);
    expect(byCategory("shadow").length).toBeGreaterThan(0);
  });

  it("marks inferred tokens as inferred, not as Figma variables", () => {
    expect(tokens.every((token) => token.source === "inferred")).toBe(true);
  });

  it("returns nothing for an empty document", () => {
    expect(extractTokens({})).toEqual([]);
  });
});
