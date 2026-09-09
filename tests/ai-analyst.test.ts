import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerProvider, resetRegistry } from "@/lib/ai/registry";
import { BaseModelProvider } from "@/lib/ai/providers/base";
import { runDesignAnalyst, AnalystError } from "@/lib/ai/agents/design-analyst";
import { structuredCall, StructuredCallError } from "@/lib/ai/structured";
import { designAnalysisSchema, DESIGN_ANALYSIS_JSON_SCHEMA } from "@/lib/ai/schemas";
import { normalizeFigmaFile } from "@/lib/figma/normalize";
import { FILE } from "./fixtures/figma-file";
import type {
  EmbedResult, GenerateOptions, GenerateResult, ModelCapability, StructuredResult,
} from "@/lib/ai/types";

const { document } = normalizeFigmaFile(FILE, { projectId: "p1", fileKey: "8kQ2" });

/** A provider that returns whatever the test queues, so the agent path is real. */
class ScriptedProvider extends BaseModelProvider {
  readonly key = "scripted";
  readonly displayName = "Scripted";
  readonly kind = "external" as const;
  readonly capabilities: ReadonlySet<ModelCapability> = new Set(["generate", "structured", "vision"]);

  calls: GenerateOptions[] = [];

  constructor(private readonly queue: unknown[]) {
    super();
  }

  async generate(_options: GenerateOptions): Promise<GenerateResult> {
    throw new Error("not used");
  }
  async *stream(_options: GenerateOptions) { yield ""; }
  async embed(_inputs: string[]): Promise<EmbedResult> { throw new Error("not used"); }

  async structuredGenerate<T>(options: GenerateOptions & { schema: Record<string, unknown> }): Promise<StructuredResult<T>> {
    this.calls.push(options);
    const next = this.queue.shift();
    if (next instanceof Error) throw next;
    return {
      value: next as T,
      usage: { inputTokens: 5000, outputTokens: 800, costUsd: 0.027, latencyMs: 900 },
      modelKey: "claude-sonnet-4-5",
      providerKey: this.key,
      finishReason: "stop",
    };
  }
}

function validAnalysis(overrides: Record<string, unknown> = {}) {
  return {
    summary: "A marketing landing page with a navbar, hero and three feature cards.",
    pageKind: "marketing",
    sections: [
      { nodeId: "1:3", role: "navbar", confidence: 98, rationale: "top band" },
      { nodeId: "1:7", role: "hero", confidence: 97, rationale: "first tall section" },
    ],
    corrections: [{ nodeId: "1:12", role: "feature_grid", confidence: 94, reason: "three equal cards" }],
    concerns: ["Two fonts are not available on Google Fonts."],
    ...overrides,
  };
}

beforeEach(() => resetRegistry());

describe("runDesignAnalyst", () => {
  it("returns a validated analysis and reports what it cost", async () => {
    registerProvider(new ScriptedProvider([validAnalysis()]));

    const result = await runDesignAnalyst({ document });

    expect(result.analysis.pageKind).toBe("marketing");
    expect(result.analysis.sections).toHaveLength(2);
    expect(result.usage.costUsd).toBeCloseTo(0.027);
    expect(result.attempts).toBe(1);
  });

  it("reports how much of the design fitted in context", async () => {
    registerProvider(new ScriptedProvider([validAnalysis()]));
    const result = await runDesignAnalyst({ document });

    expect(result.context.totalNodes).toBe(Object.keys(document.nodes).length);
    expect(result.context.includedNodes).toBeGreaterThan(0);
    expect(result.context.includedNodes).toBeLessThanOrEqual(result.context.totalNodes);
  });

  it("marks the design content as untrusted", async () => {
    const provider = new ScriptedProvider([validAnalysis()]);
    registerProvider(provider);

    await runDesignAnalyst({ document });

    expect(provider.calls[0].messages[0].untrusted).toBe(true);
  });

  it("tells the model in its system prompt not to obey the design", async () => {
    const provider = new ScriptedProvider([validAnalysis()]);
    registerProvider(provider);

    await runDesignAnalyst({ document });

    expect(provider.calls[0].system).toMatch(/untrusted data/i);
  });

  // A model can name a node that was never in the prompt. Those must not reach
  // the database, where they would corrupt the IR.
  it("drops references to nodes it was never shown", async () => {
    registerProvider(
      new ScriptedProvider([
        validAnalysis({
          sections: [
            { nodeId: "1:3", role: "navbar", confidence: 98, rationale: "real" },
            { nodeId: "9:99", role: "hero", confidence: 90, rationale: "hallucinated" },
          ],
          corrections: [{ nodeId: "does-not-exist", role: "card", confidence: 80, reason: "invented" }],
        }),
      ]),
    );

    const result = await runDesignAnalyst({ document });

    expect(result.analysis.sections.map((section) => section.nodeId)).toEqual(["1:3"]);
    expect(result.analysis.corrections).toHaveLength(0);
  });

  it("retries once when the output fails validation, then succeeds", async () => {
    const provider = new ScriptedProvider([
      validAnalysis({ pageKind: "not-a-real-kind" }),
      validAnalysis(),
    ]);
    registerProvider(provider);

    const result = await runDesignAnalyst({ document });

    expect(result.attempts).toBe(2);
    // The repair turn tells the model what was wrong.
    expect(provider.calls[1].messages.at(-1)?.content[0]).toMatchObject({ type: "text" });
    expect(JSON.stringify(provider.calls[1].messages.at(-1))).toContain("pageKind");
  });

  it("bills both attempts when it has to repair", async () => {
    registerProvider(new ScriptedProvider([validAnalysis({ pageKind: "bogus" }), validAnalysis()]));
    const result = await runDesignAnalyst({ document });
    expect(result.usage.inputTokens).toBe(10_000);
    expect(result.usage.costUsd).toBeCloseTo(0.054);
  });

  it("gives up rather than looping when output stays invalid", async () => {
    registerProvider(new ScriptedProvider([validAnalysis({ pageKind: "x" }), validAnalysis({ pageKind: "y" })]));

    await expect(runDesignAnalyst({ document })).rejects.toMatchObject({ code: "invalid_output" });
  });

  it("surfaces a provider failure without consuming the repair attempt", async () => {
    const provider = new ScriptedProvider([new Error("network down"), validAnalysis()]);
    registerProvider(provider);

    await expect(runDesignAnalyst({ document })).rejects.toMatchObject({ code: "provider_error" });
    expect(provider.calls).toHaveLength(1);
  });

  it("refuses an empty design instead of calling the model", async () => {
    const provider = new ScriptedProvider([validAnalysis()]);
    registerProvider(provider);

    await expect(runDesignAnalyst({ document: { ...document, nodes: {} } })).rejects.toBeInstanceOf(AnalystError);
    expect(provider.calls).toHaveLength(0);
  });

  it("fails clearly when no provider is configured", async () => {
    await expect(runDesignAnalyst({ document })).rejects.toMatchObject({ code: "not_configured" });
  });
});

describe("structuredCall", () => {
  it("accumulates usage even when it ultimately fails", async () => {
    registerProvider(new ScriptedProvider([{ bad: 1 }, { bad: 2 }]));

    const error = await structuredCall({
      purpose: "design_analysis",
      system: "s",
      messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
      jsonSchema: DESIGN_ANALYSIS_JSON_SCHEMA,
      validator: designAnalysisSchema,
    }).catch((caught) => caught as StructuredCallError);

    expect(error).toBeInstanceOf(StructuredCallError);
    expect((error as StructuredCallError).usage.inputTokens).toBe(10_000);
  });
});

describe("analysis schema", () => {
  it("rejects a confidence outside 0-100", () => {
    expect(designAnalysisSchema.safeParse(validAnalysis({
      sections: [{ nodeId: "1:3", role: "navbar", confidence: 150, rationale: "x" }],
    })).success).toBe(false);
  });

  it("accepts an empty corrections list as a real answer", () => {
    expect(designAnalysisSchema.safeParse(validAnalysis({ corrections: [] })).success).toBe(true);
  });

  it("advertises every required field to the model", () => {
    const required = DESIGN_ANALYSIS_JSON_SCHEMA.required as string[];
    expect(required).toEqual(["summary", "pageKind", "sections", "corrections", "concerns"]);
  });
});

/**
 * Regression tests for two bugs found while auditing the orchestration layer.
 *
 * Both were invisible with a single provider registered, which is exactly the
 * condition the model abstraction exists to move past.
 */
describe("provider attribution", () => {
  it("reports the provider that actually served the call", async () => {
    registerProvider(new ScriptedProvider([validAnalysis()]));
    const result = await runDesignAnalyst({ document });

    // Previously the ledger hardcoded "anthropic", so every run was attributed
    // to whichever provider happened to be registered first.
    expect(result.providerKey).toBe("scripted");
  });

  it("keeps attribution on a provider failure", async () => {
    const failing = new ScriptedProvider([new Error("upstream exploded")]);
    // Override the key so the test can tell which provider the ledger blames.
    Object.defineProperty(failing, "key", { value: "failing" });
    registerProvider(failing);

    const error = await runDesignAnalyst({ document }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AnalystError);
    const analystError = error as AnalystError;
    expect(analystError.code).toBe("provider_error");
    // A failed call still cost tokens and must be attributable, or the ledger
    // silently blames the wrong provider.
    expect(analystError.providerKey).toBe("failing");
  });

  it("keeps attribution when output never validates", async () => {
    registerProvider(new ScriptedProvider([{ nonsense: true }, { nonsense: true }, { nonsense: true }]));

    const error = await runDesignAnalyst({ document }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AnalystError);
    expect((error as AnalystError).code).toBe("invalid_output");
    expect((error as AnalystError).providerKey).toBe("scripted");
  });
});
