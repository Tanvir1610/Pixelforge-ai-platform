import { beforeEach, describe, expect, it } from "vitest";
import { registerProvider, resetRegistry } from "@/lib/ai/registry";
import { BaseModelProvider } from "@/lib/ai/providers/base";
import { runArchitecturePlanner } from "@/lib/ai/agents/architecture-planner";
import { runComponentPlanner, findRepeatedStructures } from "@/lib/ai/agents/component-planner";
import { AnalystError } from "@/lib/ai/agents/design-analyst";
import { normalizeFigmaFile } from "@/lib/figma/normalize";
import { FILE } from "./fixtures/figma-file";
import type {
  EmbedResult, GenerateOptions, GenerateResult, ModelCapability, StructuredResult,
} from "@/lib/ai/types";
import type { DesignAnalysis } from "@/lib/ai/schemas";

const { document } = normalizeFigmaFile(FILE, { projectId: "p1", fileKey: "8kQ2" });

class ScriptedProvider extends BaseModelProvider {
  readonly key = "scripted";
  readonly displayName = "Scripted";
  readonly kind = "external" as const;
  readonly capabilities: ReadonlySet<ModelCapability> = new Set(["generate", "structured", "vision"]);

  calls: GenerateOptions[] = [];

  constructor(private readonly queue: unknown[]) {
    super();
  }

  async generate(_options: GenerateOptions): Promise<GenerateResult> { throw new Error("not used"); }
  async *stream(_options: GenerateOptions) { yield ""; }
  async embed(_inputs: string[]): Promise<EmbedResult> { throw new Error("not used"); }

  async structuredGenerate<T>(
    options: GenerateOptions & { schema: Record<string, unknown> },
  ): Promise<StructuredResult<T>> {
    this.calls.push(options);
    const next = this.queue.shift();
    if (next instanceof Error) throw next;
    return {
      value: next as T,
      usage: { inputTokens: 3000, outputTokens: 600, costUsd: 0.02, latencyMs: 700 },
      modelKey: "scripted-1", providerKey: this.key, finishReason: "stop",
    };
  }
}

const analysis: DesignAnalysis = {
  summary: "A marketing landing page.",
  pageKind: "marketing",
  sections: [
    { nodeId: "1:3", role: "navbar", confidence: 99, rationale: "top band" },
    { nodeId: "1:7", role: "hero", confidence: 98, rationale: "first section" },
  ],
  corrections: [],
  concerns: [],
};

function validArchitecture() {
  return {
    framework: "nextjs", styling: "tailwind", typescript: true,
    routes: [{ path: "/", file: "app/page.tsx", title: "Home", frameId: "1:2" }],
    directories: [{ path: "components", purpose: "Reusable UI" }],
    tokenStrategy: "tailwind_theme",
    buildOrder: ["tokens", "layout", "components", "pages"],
  };
}

function validComponentPlan() {
  return {
    components: [
      {
        name: "FeatureCard", file: "components/FeatureCard.tsx",
        semanticRole: "feature_card", sourceNodeIds: ["1:13"],
        props: [{ name: "title", type: "string", required: true }],
        variants: [], states: [], instanceCount: 3,
        reason: "Appears three times in the feature grid.",
      },
    ],
    inlined: [],
  };
}

beforeEach(() => resetRegistry());

describe("architecture planner", () => {
  it("produces a validated plan", async () => {
    registerProvider(new ScriptedProvider([validArchitecture()]));

    const result = await runArchitecturePlanner({
      analysis, document, framework: "nextjs", styling: "tailwind", typescript: true,
    });

    expect(result.plan.routes[0].file).toBe("app/page.tsx");
    expect(result.plan.buildOrder[0]).toBe("tokens");
    expect(result.providerKey).toBe("scripted");
  });

  // Framework and styling are settings the user chose explicitly. A model
  // suggesting otherwise is overruled silently.
  it("overrides the model when it drifts from the user's settings", async () => {
    registerProvider(
      new ScriptedProvider([{ ...validArchitecture(), framework: "vue", styling: "vanilla_css", typescript: false }]),
    );

    const result = await runArchitecturePlanner({
      analysis, document, framework: "nextjs", styling: "tailwind", typescript: true,
    });

    expect(result.plan.framework).toBe("nextjs");
    expect(result.plan.styling).toBe("tailwind");
    expect(result.plan.typescript).toBe(true);
  });

  it("drops routes and directories that escape the project root", async () => {
    registerProvider(
      new ScriptedProvider([
        {
          ...validArchitecture(),
          routes: [
            { path: "/", file: "app/page.tsx", title: "Home" },
            { path: "/evil", file: "../../.env", title: "Evil" },
            { path: "/abs", file: "/etc/passwd", title: "Abs" },
          ],
          directories: [{ path: "../outside", purpose: "no" }],
        },
      ]),
    );

    const result = await runArchitecturePlanner({
      analysis, document, framework: "nextjs", styling: "tailwind", typescript: true,
    });

    expect(result.plan.routes).toHaveLength(1);
    expect(result.plan.directories).toHaveLength(0);
  });

  it("passes the design as untrusted content", async () => {
    const provider = new ScriptedProvider([validArchitecture()]);
    registerProvider(provider);

    await runArchitecturePlanner({
      analysis, document, framework: "nextjs", styling: "tailwind", typescript: true,
    });

    expect(provider.calls[0].messages.some((message) => message.untrusted)).toBe(true);
    // Settings are ours, so they are NOT fenced as untrusted.
    expect(provider.calls[0].messages.some((message) => !message.untrusted)).toBe(true);
  });

  it("surfaces a provider failure as an AnalystError", async () => {
    registerProvider(new ScriptedProvider([new Error("down")]));
    const error = await runArchitecturePlanner({
      analysis, document, framework: "nextjs", styling: "tailwind", typescript: true,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AnalystError);
    expect((error as AnalystError).providerKey).toBe("scripted");
  });
});

describe("findRepeatedStructures", () => {
  it("groups the three feature cards into one candidate", () => {
    const candidates = findRepeatedStructures(document);
    const card = candidates.find((candidate) => candidate.role === "feature_card");

    expect(card?.count).toBe(3);
    expect(card?.exampleIds).toContain("1:13");
  });

  // A button appearing once is still worth extracting; an arbitrary container
  // appearing once is not.
  it("keeps single-instance UI primitives", () => {
    const roles = findRepeatedStructures(document).map((candidate) => candidate.role);
    expect(roles).toContain("button");
  });

  it("returns nothing for an empty document", () => {
    expect(findRepeatedStructures({ ...document, nodes: {} })).toEqual([]);
  });
});

describe("component planner", () => {
  it("produces a validated plan from the candidates", async () => {
    registerProvider(new ScriptedProvider([validComponentPlan()]));
    const result = await runComponentPlanner({ architecture: validArchitecture() as never, document });

    expect(result.plan.components[0].name).toBe("FeatureCard");
    expect(result.candidates).toBeGreaterThan(0);
  });

  it("drops source node ids the model invented", async () => {
    registerProvider(
      new ScriptedProvider([
        {
          components: [
            { ...validComponentPlan().components[0], sourceNodeIds: ["1:13", "99:99", "made-up"] },
          ],
          inlined: [],
        },
      ]),
    );

    const result = await runComponentPlanner({ architecture: validArchitecture() as never, document });
    expect(result.plan.components[0].sourceNodeIds).toEqual(["1:13"]);
  });

  it("rejects a component whose file escapes the project root", async () => {
    registerProvider(
      new ScriptedProvider([
        {
          components: [
            { ...validComponentPlan().components[0], file: "../../evil.tsx" },
            validComponentPlan().components[0],
          ],
          inlined: [],
        },
      ]),
    );

    const result = await runComponentPlanner({ architecture: validArchitecture() as never, document });
    expect(result.plan.components).toHaveLength(1);
    expect(result.plan.components[0].file).toBe("components/FeatureCard.tsx");
  });

  it("enforces PascalCase names through the schema", async () => {
    registerProvider(
      new ScriptedProvider([
        { components: [{ ...validComponentPlan().components[0], name: "feature card" }], inlined: [] },
        { components: [{ ...validComponentPlan().components[0], name: "feature card" }], inlined: [] },
      ]),
    );

    const error = await runComponentPlanner({
      architecture: validArchitecture() as never, document,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AnalystError);
    expect((error as AnalystError).code).toBe("invalid_output");
  });

  it("refuses to plan when there is nothing to componentise", async () => {
    registerProvider(new ScriptedProvider([validComponentPlan()]));
    const error = await runComponentPlanner({
      architecture: validArchitecture() as never,
      document: { ...document, nodes: {} },
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AnalystError);
    expect((error as AnalystError).code).toBe("empty_design");
  });
});
