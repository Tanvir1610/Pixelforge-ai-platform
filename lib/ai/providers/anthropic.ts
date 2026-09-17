import { BaseModelProvider } from "./base";
import { computeCost, getModel, selectModel, type ModelSpec } from "../models";
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
  /** Populated only on a refusal. Informational: branch on stop_reason. */
  stop_details?: { type?: string; category?: string | null } | null;
  /** The model that produced this message, which differs after a fallback. */
  model: string;
  usage: { input_tokens: number; output_tokens: number };
}

/** Beta header gating `fallbacks: "default"`. The array form uses a different one. */
const SERVER_FALLBACK_BETA = "server-side-fallback-2026-07-01";

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
/**
 * A provider failure that carries what the API said.
 *
 * `anthropic_400` alone cost two debugging rounds: a stale model id, a removed
 * sampling parameter and an unscoped API key all arrive as the same status,
 * and all three are configuration faults that no amount of retrying fixes.
 * The API states which one it is; this keeps that.
 */
export class AnthropicApiError extends Error {
  constructor(
    readonly status: number,
    /** The API's own message. Names parameters and headers, never secrets. */
    readonly detail: string,
  ) {
    super(`anthropic_${status}`);
    this.name = "AnthropicApiError";
  }

  /**
   * True when the request itself is wrong rather than the service unavailable.
   *
   * The distinction decides whether "try again in a moment" is honest advice or
   * an instruction to repeat something that can never succeed.
   */
  get isConfiguration(): boolean {
    return this.status === 400 || this.status === 401 || this.status === 403 || this.status === 404;
  }
}

/**
 * The model declined the request.
 *
 * Not an HTTP error: it arrives as a 200 with `stop_reason: "refusal"` and
 * either no content or a partial one. Reading it as ordinary output turned it
 * into "the model returned an unusable shape", which sends someone retrying a
 * request that will be declined again. With server-side fallbacks on, reaching
 * this means the fallback model declined as well.
 */
export class AnthropicRefusalError extends Error {
  constructor(
    readonly category: string | null,
    readonly modelKey: string,
  ) {
    super(`anthropic_refusal${category ? `:${category}` : ""}`);
    this.name = "AnthropicRefusalError";
  }
}

/** Pulls the human-readable part out of the API's error envelope. */
export function describeAnthropicError(status: number, body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } };
    if (parsed.error?.message) return parsed.error.message;
  } catch {
    // Not JSON; fall through to the raw body.
  }
  return body.slice(0, 300) || `HTTP ${status}`;
}

/**
 * Request headers.
 *
 * An organization-scoped API key must name a workspace on every request:
 * without the header the API rejects it with "This API key is not scoped to a
 * workspace". A key that is already workspace-scoped needs nothing, so the
 * header is sent only when configured — passing an empty one is itself an
 * error.
 */
function headersFor(apiKey: string, betas: string[] = []): Record<string, string> {
  const workspaceId = process.env.ANTHROPIC_WORKSPACE_ID?.trim();

  return {
    "content-type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": VERSION,
    ...(workspaceId ? { "anthropic-workspace-id": workspaceId } : {}),
    ...(betas.length ? { "anthropic-beta": betas.join(",") } : {}),
  };
}

/**
 * Request fields that depend on what the chosen model accepts.
 *
 * Each is sent only where it is valid, for the same reason `temperature` is:
 * a parameter a model does not take is rejected with a 400, not ignored.
 */
function modelFields(spec: ModelSpec | undefined, options: GenerateOptions) {
  const betas: string[] = [];
  const body: Record<string, unknown> = {};

  if (spec?.acceptsSampling) body.temperature = options.temperature ?? 0;
  if (spec?.acceptsEffort && options.effort) body.output_config = { effort: options.effort };

  if (spec?.serverFallback) {
    // "default" rather than a pinned model: the right substitute depends on
    // why the request was declined, and a pinned model is a migration owed
    // the day it is deprecated.
    betas.push(SERVER_FALLBACK_BETA);
    body.fallbacks = "default";
  }

  return { betas, body };
}

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
        content: message.content.map((part) => ({
          ...(part.type === "text"
            ? { type: "text" as const, text: message.untrusted ? this.fence(part.text) : part.text }
            : {
                type: "image" as const,
                source: { type: "base64" as const, media_type: part.mediaType, data: part.data },
              }),
          // A breakpoint, not a flag on the content: the API caches the whole
          // prefix up to here, so it belongs after the last repeated block.
          ...(part.cache ? { cache_control: { type: "ephemeral" as const } } : {}),
        })),
      }));
  }

  private resolveModelKey(options: GenerateOptions): string {
    if (this.modelOverride) return this.modelOverride;
    const capability = options.schema ? "structured" : "generate";
    return selectModel(options.purpose, capability)?.key ?? "claude-sonnet-5";
  }

  private async call(options: GenerateOptions, extra: Record<string, unknown> = {}): Promise<{
    response: AnthropicResponse;
    modelKey: string;
    latencyMs: number;
  }> {
    const modelKey = this.resolveModelKey(options);
    const spec = getModel(modelKey);
    const started = Date.now();
    const fields = modelFields(spec, options);

    const response = await this.fetchImpl(API, {
      method: "POST",
      headers: headersFor(this.apiKey, fields.betas),
      body: JSON.stringify({
        model: modelKey,
        // On models that think by default this caps thinking and the answer
        // together, so callers size it for both.
        max_tokens: Math.min(options.maxOutputTokens ?? 4096, spec?.maxOutputTokens ?? 8192),
        ...fields.body,
        system: options.system,
        messages: this.toWireMessages(options.messages),
        ...extra,
      }),
      signal: options.signal,
    });

    if (!response.ok) {
      // The status alone is not enough to act on: a 400 is almost always a
      // request the API rejected for a stated reason — an unknown model id, a
      // parameter removed from this generation — and throwing only the code
      // turned each of those into a debugging session. The body is logged, not
      // returned: callers still map the code to user-facing copy.
      const body = await response.text().catch(() => "");
      const detail = describeAnthropicError(response.status, body);
      console.error(`[anthropic] ${response.status}`, detail);
      throw new AnthropicApiError(response.status, detail);
    }

    const parsed = (await response.json()) as AnthropicResponse;

    // Checked before anything reads `content`, which on a refusal is empty or
    // partial. Declining is a 200, so nothing above catches it.
    if (parsed.stop_reason === "refusal") {
      console.error("[anthropic] refusal", modelKey, parsed.stop_details?.category ?? "uncategorised");
      throw new AnthropicRefusalError(parsed.stop_details?.category ?? null, parsed.model || modelKey);
    }

    return {
      response: parsed,
      // After a server-side fallback the message was produced by a different
      // model. Attributed to it when it is one this table knows, so the ledger
      // records what actually ran; otherwise the requested model, whose price
      // the fallback models share.
      modelKey: parsed.model && getModel(parsed.model) ? parsed.model : modelKey,
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
    const spec = getModel(modelKey);
    const fields = modelFields(spec, options);
    const response = await this.fetchImpl(API, {
      method: "POST",
      headers: headersFor(this.apiKey, fields.betas),
      body: JSON.stringify({
        model: modelKey,
        max_tokens: options.maxOutputTokens ?? 4096,
        ...fields.body,
        system: options.system,
        messages: this.toWireMessages(options.messages),
        stream: true,
      }),
      signal: options.signal,
    });

    if (!response.ok || !response.body) {
      const body = response.ok ? "no response body" : await response.text().catch(() => "");
      const detail = describeAnthropicError(response.status, body);
      console.error(`[anthropic:stream] ${response.status}`, detail);
      throw new AnthropicApiError(response.status, detail);
    }

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
