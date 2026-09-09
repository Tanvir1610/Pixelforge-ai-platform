import { describe, expect, it } from "vitest";
import { computeCost, estimateTokens, getModel, MODELS, PURPOSE_TIER, selectModel } from "@/lib/ai/models";

describe("model catalogue", () => {
  it("computes cost from the platform's own price table", () => {
    const spec = getModel("claude-sonnet-4-5")!;
    // 1M in at $3, 100k out at $15 → 3 + 1.5
    expect(computeCost(spec, 1_000_000, 100_000)).toBeCloseTo(4.5, 6);
  });

  it("rounds cost to the precision the ledger column stores", () => {
    const spec = getModel("claude-haiku-4-5-20251001")!;
    const cost = computeCost(spec, 7, 3);
    expect(cost).toBe(Number(cost.toFixed(6)));
  });

  it("charges nothing for a call that used nothing", () => {
    expect(computeCost(getModel("claude-opus-4-5")!, 0, 0)).toBe(0);
  });

  it("routes architecture planning to the frontier tier", () => {
    expect(PURPOSE_TIER.architecture_planning).toBe("frontier");
    expect(selectModel("architecture_planning", "generate")?.tier).toBe("frontier");
  });

  // Mechanical work must not silently land on the expensive model.
  it("routes refinement to the fast tier", () => {
    expect(selectModel("refinement", "generate")?.tier).toBe("fast");
  });

  it("picks the cheapest model within the chosen tier", () => {
    const chosen = selectModel("design_analysis", "generate")!;
    const sameTier = MODELS.filter((model) => model.tier === chosen.tier);
    expect(chosen.inputCostPerMTok).toBe(Math.min(...sameTier.map((model) => model.inputCostPerMTok)));
  });

  it("falls back across tiers rather than returning nothing", () => {
    expect(selectModel("visual_qa", "vision")).toBeDefined();
  });

  it("returns nothing for a capability no model has", () => {
    expect(selectModel("embedding", "embed")).toBeUndefined();
  });

  it("estimates tokens pessimistically enough to budget with", () => {
    const text = "x".repeat(3500);
    expect(estimateTokens(text)).toBeGreaterThanOrEqual(1000);
  });
});
