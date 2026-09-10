import type { z } from "zod";
import { resolveProvider } from "./registry";
import { AnthropicApiError } from "./providers/anthropic";
import type { ModelMessage, ModelPurpose, ModelUsage } from "./types";

export interface StructuredCallOptions<T> {
  purpose: ModelPurpose;
  system: string;
  messages: ModelMessage[];
  jsonSchema: Record<string, unknown>;
  /**
   * The input side is `unknown` so `T` binds to the schema's *output* type.
   * With `z.ZodType<T>` a schema using `.default()` would infer its input
   * shape, and every defaulted field would surface as optional downstream.
   */
  validator: z.ZodType<T, z.ZodTypeDef, unknown>;
  maxOutputTokens?: number;
  /** One repair attempt by default: worth a retry, not worth a loop. */
  maxAttempts?: number;
  signal?: AbortSignal;
}

export interface StructuredCallResult<T> {
  value: T;
  usage: ModelUsage;
  modelKey: string;
  providerKey: string;
  attempts: number;
}

export class StructuredCallError extends Error {
  constructor(
    readonly code: "invalid_output" | "provider_error" | "provider_misconfigured",
    message: string,
    readonly attempts: number,
    readonly usage: ModelUsage,
    // Attribution survives the failure, so the ledger records which provider
    // actually failed rather than defaulting to the first one registered.
    readonly providerKey = "unknown",
    readonly modelKey = "unknown",
  ) {
    super(message);
    this.name = "StructuredCallError";
  }
}

const EMPTY_USAGE: ModelUsage = { inputTokens: 0, outputTokens: 0, costUsd: 0, latencyMs: 0 };

function addUsage(a: ModelUsage, b: ModelUsage): ModelUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    costUsd: Math.round((a.costUsd + b.costUsd) * 1_000_000) / 1_000_000,
    latencyMs: a.latencyMs + b.latencyMs,
  };
}

/**
 * A schema-constrained model call that is validated on our side too.
 *
 * The API enforces the JSON shape; Zod enforces the semantics the schema cannot
 * express — enum membership, string lengths, PascalCase names. A model can
 * satisfy a JSON Schema and still return something unusable, so both run.
 *
 * On a validation failure the errors are fed back once. Beyond that it fails:
 * a retry loop against a model that keeps producing the same wrong shape burns
 * budget without converging.
 *
 * Usage is accumulated across attempts, so a failed call is still billed
 * honestly rather than disappearing from the ledger.
 */
export async function structuredCall<T>(options: StructuredCallOptions<T>): Promise<StructuredCallResult<T>> {
  const { purpose, system, messages, jsonSchema, validator, maxAttempts = 2 } = options;
  const provider = resolveProvider(purpose);

  let usage = EMPTY_USAGE;
  let lastIssues = "";

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const attemptMessages: ModelMessage[] =
      attempt === 1
        ? messages
        : [
            ...messages,
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text:
                    `Your previous response did not validate:\n${lastIssues}\n` +
                    "Return the same analysis with those fields corrected.",
                },
              ],
            },
          ];

    let raw: unknown;
    try {
      const result = await provider.structuredGenerate<unknown>({
        purpose,
        system,
        messages: attemptMessages,
        schema: jsonSchema,
        maxOutputTokens: options.maxOutputTokens,
        signal: options.signal,
      });
      usage = addUsage(usage, result.usage);
      raw = result.value;

      const parsed = validator.safeParse(raw);
      if (parsed.success) {
        return {
          value: parsed.data,
          usage,
          modelKey: result.modelKey,
          providerKey: result.providerKey,
          attempts: attempt,
        };
      }

      lastIssues = parsed.error.issues
        .slice(0, 8)
        .map((issue) => `- ${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("\n");
    } catch (error) {
      // A transport or provider failure is not something a reworded prompt
      // fixes, so it fails immediately rather than consuming the repair attempt.
      // A rejected request is not a flaky one. Telling the user to try again
      // when the API said the model id is unknown, or the key names no
      // workspace, is advice that can only ever waste their time.
      const misconfigured = error instanceof AnthropicApiError && error.isConfiguration;

      throw new StructuredCallError(
        misconfigured ? "provider_misconfigured" : "provider_error",
        error instanceof AnthropicApiError
          ? error.detail
          : error instanceof Error ? error.message : "provider call failed",
        attempt,
        usage,
        provider.key,
      );
    }
  }

  throw new StructuredCallError(
    "invalid_output",
    `Model output failed validation after ${maxAttempts} attempts:\n${lastIssues}`,
    maxAttempts,
    usage,
    provider.key,
  );
}
