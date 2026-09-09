import { BaseModelProvider } from "./base";
import type { EmbedResult, GenerateOptions, GenerateResult, ModelCapability, StructuredResult } from "@/lib/ai/types";

/**
 * Placeholder registered when no inference provider is configured.
 *
 * It exists so the registry has a valid shape to return and so callers fail
 * with a clear, actionable error instead of a null dereference. It never
 * fabricates output — a stub that returned plausible text would be worse than
 * no provider at all, because it would look like the pipeline works.
 */
export class UnconfiguredProvider extends BaseModelProvider {
  readonly key = "unconfigured";
  readonly displayName = "No model configured";
  readonly kind = "external" as const;
  readonly capabilities: ReadonlySet<ModelCapability> = new Set();

  private fail(): never {
    throw new Error(
      "No model provider is configured. Register one in lib/ai/registry.ts and set its API key. " +
        "See docs/MODEL_PROVIDER.md.",
    );
  }

  async generate(_options: GenerateOptions): Promise<GenerateResult> {
    this.fail();
  }

  async *stream(_options: GenerateOptions): AsyncIterable<string> {
    this.fail();
  }

  async structuredGenerate<T>(
    _options: GenerateOptions & { schema: Record<string, unknown> },
  ): Promise<StructuredResult<T>> {
    this.fail();
  }

  async embed(_inputs: string[]): Promise<EmbedResult> {
    this.fail();
  }
}
