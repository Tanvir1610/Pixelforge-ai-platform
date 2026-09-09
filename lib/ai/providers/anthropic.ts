import { BaseModelProvider } from "./base";
import { computeCost, getModel, selectModel } from "../models";
import {
  type EmbedResult, type GenerateOptions, type GenerateResult, type ModelCapability,
  type ModelMessage, type StructuredResult,
} from "../types";

const API = "https://api.anthropic.com/v1/messages";
const VERSION = "2023-06-01";

interface AnthropicContentBlock {
  type: string;
  text?: string;
}

interface AnthropicResponse {
  content: AnthropicContentBlock[];
  stop_reason: string | null;
  model: string;
  usage: { input_tokens: number; output_tokens: number };
}

export interface AnthropicOptions {
  apiKey: string;
  fetchImpl?: typeof fetch;
  /** Overrides tier-based selection. Mostly for evaluation runs. */
  model?: string;
}

/**
 * Anthropic provider.
 *
 * Implements the platform's ModelProvider interface; nothing above this file
 * knows the vendor. Swapping in our own model later means registering a
 * different class, not changing any agent.
 */
export class AnthropicProvider extends BaseModelProvider {
  readonly key = "anthropic";
  readonly displayName = "Anthropic";
  readonly kind = "external" as const;
  readonly capabilities: ReadonlySet<ModelCapability> = new Set([
    "generate", "stream", "structured", "vision", "analyze",
  ]);

  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly modelOverride?: string;

  constructor({ apiKey, fetchImpl = fetch, model }: AnthropicOptions) {
    super();
    this.apiKey = apiKey;
    this.fetchImpl = fetchImpl;
    this.modelOverride = model;
  }

  /**
   * Converts platform messages to the wire format, applying the untrusted
   * fence. Content marked `untrusted` is wrapped so instructions inside a Figma
   * layer or a README are presented as data, never promoted to an instruction.
   */
  private toWireMessages(messages: ModelMessage[]) {
    return messages
      .filter((message) => message.role !== "system")
      .map((message) => ({
        role: message.role === "assistant" ? "assistant" : "user",
        content: message.content.map((part) =>
          part.type === "text"
            ? { type: "text" as const, text: message.untrusted ? this.fence(part.text) : part.text }
            : {
                type: "image" as const,
                source: { type: "base64" as const, media_type: part.mediaType, data: part.data },
              },
        ),
      }));
  }

  private resolveModelKey(options: GenerateOptions): string {
    if (this.modelOverride) return this.modelOverride;
    const capability = options.schema ? "structured" : "generate";
    return selectModel(options.purpose, capability)?.key ?? "claude-sonnet-4-5";
  }

  private async call(options: GenerateOptions, extra: Record<string, unknown> = {}): Promise<{
    response: AnthropicResponse;
    modelKey: string;
    latencyMs: number;
  }> {
    const modelKey = this.resolveModelKey(options);
    const spec = getModel(modelKey);
    const started = Date.now();

    const response = await this.fetchImpl(API, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": VERSION,
      },
      body: JSON.stringify({
        model: modelKey,
        max_tokens: Math.min(options.maxOutputTokens ?? 4096, spec?.maxOutputTokens ?? 8192),
        temperature: options.temperature ?? 0,
        system: options.system,
        messages: this.toWireMessages(options.messages),
        ...extra,
      }),
      signal: options.signal,
    });

    if (!response.ok) {
      // Provider error text is not user-facing; callers map codes to copy.
      throw new Error(`anthropic_${response.status}`);
    }

    return {
      response: (await response.json()) as AnthropicResponse,
      modelKey,
      latencyMs: Date.now() - started,
    };
  }

  private usage(response: AnthropicResponse, modelKey: string, latencyMs: number) {
    const spec = getModel(modelKey);
    const { input_tokens: inputTokens, output_tokens: outputTokens } = response.usage;
    return {
      inputTokens,
      outputTokens,
      costUsd: spec ? computeCost(spec, inputTokens, outputTokens) : 0,
      latencyMs,
    };
  }

  async generate(options: GenerateOptions): Promise<GenerateResult> {
    const { response, modelKey, latencyMs } = await this.call(options);
    const text = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("");

    return {
      text,
      usage: this.usage(response, modelKey, latencyMs),
      modelKey,
      providerKey: this.key,
      finishReason: response.stop_reason === "max_tokens" ? "length" : "stop",
    };
  }

  /**
   * Structured output via a forced tool call, which is the reliable way to get
   * schema-conforming JSON: the model cannot answer in prose, and the shape is
   * enforced by the API rather than by parsing hope.
   */
  async structuredGenerate<T>(
    options: GenerateOptions & { schema: Record<string, unknown> },
  ): Promise<StructuredResult<T>> {
    this.assertSupports("structured");

    const { response, modelKey, latencyMs } = await this.call(options, {
      tools: [{ name: "respond", description: "Return the result.", input_schema: options.schema }],
      tool_choice: { type: "tool", name: "respond" },
    });

    const toolUse = (response.content as (AnthropicContentBlock & { input?: unknown })[]).find(
      (block) => block.type === "tool_use",
    );

    if (!toolUse?.input) throw new Error("structured_no_tool_use");

    return {
      value: toolUse.input as T,
      usage: this.usage(response, modelKey, latencyMs),
      modelKey,
      providerKey: this.key,
      finishReason: "stop",
    };
  }

  async *stream(options: GenerateOptions): AsyncIterable<string> {
    this.assertSupports("stream");

    const modelKey = this.resolveModelKey(options);
    const response = await this.fetchImpl(API, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": VERSION,
      },
      body: JSON.stringify({
        model: modelKey,
        max_tokens: options.maxOutputTokens ?? 4096,
        temperature: options.temperature ?? 0,
        system: options.system,
        messages: this.toWireMessages(options.messages),
        stream: true,
      }),
      signal: options.signal,
    });

    if (!response.ok || !response.body) throw new Error(`anthropic_${response.status}`);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6).trim();
        if (payload === "[DONE]") return;
        try {
          const event = JSON.parse(payload) as { type: string; delta?: { text?: string } };
          if (event.type === "content_block_delta" && event.delta?.text) yield event.delta.text;
        } catch {
          // A partial frame across chunk boundaries; the next read completes it.
        }
      }
    }
  }

  async embed(_inputs: string[]): Promise<EmbedResult> {
    // Anthropic has no embeddings endpoint. Reporting this honestly is what
    // lets the router send embedding work elsewhere instead of failing at call
    // time — see registry.resolveProvider.
    this.assertSupports("embed");
    throw new Error("unreachable");
  }
}
