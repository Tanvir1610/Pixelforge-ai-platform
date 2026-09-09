import { beforeEach, describe, expect, it } from "vitest";
import { registerProvider, resetRegistry } from "@/lib/ai/registry";
import { BaseModelProvider } from "@/lib/ai/providers/base";
import { runCodeStep } from "@/lib/ai/agents/code-generator";
import { AnalystError } from "@/lib/ai/agents/design-analyst";
import { normalizeFigmaFile } from "@/lib/figma/normalize";
import { FILE } from "./fixtures/figma-file";
import type {
  EmbedResult, GenerateOptions, GenerateResult, ModelCapability, StructuredResult,
} from "@/lib/ai/types";
import type { ArchitecturePlan, ComponentPlan } from "@/lib/ai/planning-schemas";

const { document } = normalizeFigmaFile(FILE, { projectId: "p1", fileKey: "8kQ2" });

class ScriptedProvider extends BaseModelProvider {
  readonly key = "scripted";
  readonly displayName = "Scripted";
  readonly kind = "external" as const;
  readonly capabilities: ReadonlySet<ModelCapability> = new Set(["generate", "structured"]);

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
      usage: { inputTokens: 4000, outputTokens: 2000, costUsd: 0.05, latencyMs: 2200 },
      modelKey: "scripted-1", providerKey: this.key, finishReason: "stop",
    };
  }
}

const architecture: ArchitecturePlan = {
  framework: "nextjs", styling: "tailwind", typescript: true,
  routes: [{ path: "/", file: "app/page.tsx", title: "Home" }],
  directories: [{ path: "components", purpose: "UI" }],
  tokenStrategy: "tailwind_theme",
  buildOrder: ["tokens", "components", "pages"],
};

const components: ComponentPlan = {
  components: [
    {
      name: "Hero", file: "components/Hero.tsx", semanticRole: "hero",
      sourceNodeIds: ["1:7"], props: [{ name: "title", type: "string", required: true }],
      variants: [], states: [], instanceCount: 1, reason: "Top section.",
    },
  ],
  inlined: [],
};

function step(files: { path: string; content: string }[], notes?: string) {
  return { files, deletions: [], notes };
}

beforeEach(() => resetRegistry());

describe("code generator", () => {
  it("returns the files for a step", async () => {
    registerProvider(
      new ScriptedProvider([step([{ path: "components/Hero.tsx", content: "export function Hero() {}" }])]),
    );

    const result = await runCodeStep({
      step: "components", architecture, components, document, existingFiles: [],
    });

    expect(result.files).toHaveLength(1);
    expect(result.files[0].path).toBe("components/Hero.tsx");
    expect(result.providerKey).toBe("scripted");
  });

  /**
   * A path escaping the root is rejected, not rewritten. Silently relocating it
   * would leave the model believing it wrote somewhere else, and the imports it
   * generates next would break confusingly.
   */
  it("rejects files that escape the project root and reports them", async () => {
    registerProvider(
      new ScriptedProvider([
        step([
          { path: "../../.env", content: "SECRET=1" },
          { path: "/etc/passwd", content: "root" },
          { path: "app/page.tsx", content: "export default function Page() {}" },
        ]),
      ]),
    );

    const result = await runCodeStep({
      step: "pages", architecture, components, document, existingFiles: [],
    });

    expect(result.files).toHaveLength(1);
    expect(result.files[0].path).toBe("app/page.tsx");
    expect(result.rejectedPaths).toEqual(["../../.env", "/etc/passwd"]);
  });

  it("tells the model which files already exist so imports resolve", async () => {
    const provider = new ScriptedProvider([step([{ path: "app/page.tsx", content: "x" }])]);
    registerProvider(provider);

    await runCodeStep({
      step: "pages", architecture, components, document,
      existingFiles: ["components/Hero.tsx", "app/globals.css"],
    });

    const prompt = provider.calls[0].messages.map((message) =>
      message.content.map((part) => ("text" in part ? part.text : "")).join(""),
    ).join("\n");

    expect(prompt).toContain("components/Hero.tsx");
    expect(prompt).toContain("app/globals.css");
    expect(prompt).toContain("STEP TO GENERATE: pages");
  });

  it("says so when nothing exists yet", async () => {
    const provider = new ScriptedProvider([step([{ path: "a.css", content: "x" }])]);
    registerProvider(provider);

    await runCodeStep({ step: "tokens", architecture, components, document, existingFiles: [] });

    const prompt = provider.calls[0].messages
      .map((message) => message.content.map((part) => ("text" in part ? part.text : "")).join(""))
      .join("\n");
    expect(prompt).toContain("this is the first step");
  });

  it("passes build errors into a repair pass", async () => {
    const provider = new ScriptedProvider([step([{ path: "components/Hero.tsx", content: "fixed" }])]);
    registerProvider(provider);

    await runCodeStep({
      step: "repair build errors", architecture, components, document,
      existingFiles: ["components/Hero.tsx"],
      previousErrors: [
        { filePath: "components/Hero.tsx", line: 3, message: "Cannot find module '@/lib/tokens'" },
      ],
    });

    const prompt = provider.calls[0].messages
      .map((message) => message.content.map((part) => ("text" in part ? part.text : "")).join(""))
      .join("\n");

    expect(prompt).toContain("ERRORS FROM THE LAST BUILD");
    expect(prompt).toContain("Cannot find module");
    expect(prompt).toContain("components/Hero.tsx:3");
  });

  it("fences the design tokens as untrusted content", async () => {
    const provider = new ScriptedProvider([step([{ path: "a.css", content: "x" }])]);
    registerProvider(provider);

    await runCodeStep({ step: "tokens", architecture, components, document, existingFiles: [] });

    expect(provider.calls[0].messages.some((message) => message.untrusted)).toBe(true);
    // Architecture is ours, so it is not fenced.
    expect(provider.calls[0].messages.some((message) => !message.untrusted)).toBe(true);
  });

  it("accepts a step that legitimately writes nothing", async () => {
    registerProvider(new ScriptedProvider([step([], "Nothing to do for this step.")]));

    const result = await runCodeStep({
      step: "interactions", architecture, components, document, existingFiles: ["app/page.tsx"],
    });

    expect(result.files).toEqual([]);
    expect(result.notes).toContain("Nothing to do");
  });

  it("rejects truncated output through the schema", async () => {
    // An empty content string is what a cut-off response looks like.
    registerProvider(
      new ScriptedProvider([
        step([{ path: "app/page.tsx", content: "" }]),
        step([{ path: "app/page.tsx", content: "" }]),
      ]),
    );

    const error = await runCodeStep({
      step: "pages", architecture, components, document, existingFiles: [],
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AnalystError);
    expect((error as AnalystError).code).toBe("invalid_output");
  });

  it("keeps provider attribution on failure", async () => {
    registerProvider(new ScriptedProvider([new Error("upstream down")]));

    const error = await runCodeStep({
      step: "pages", architecture, components, document, existingFiles: [],
    }).catch((caught: unknown) => caught);

    expect((error as AnalystError).providerKey).toBe("scripted");
    expect((error as AnalystError).code).toBe("provider_error");
  });
});
