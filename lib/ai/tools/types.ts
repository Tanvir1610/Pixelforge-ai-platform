import type { z } from "zod";

/**
 * The AI tool system (§16).
 *
 * Agents do not touch the database or the filesystem directly. They call tools,
 * every call is validated against a schema, authorised by mode, and recorded in
 * `ai_tool_calls` with its arguments and outcome. That ledger is what makes a
 * generation auditable after the fact, and it is the training signal for later
 * models.
 */
export type ToolMode = "read" | "write";

export interface ToolContext {
  projectId: string;
  organizationId: string;
  generationRunId?: string;
  /**
   * The version an agent reads from and writes into. Absent during planning,
   * which happens before any code exists.
   */
  codeVersionId?: string;
  /**
   * Caps what this invocation may do regardless of which tools were passed in.
   * A planner runs read-only even though write tools exist in the registry.
   */
  allowedModes: ReadonlySet<ToolMode>;
}

export interface Tool<TInput = unknown, TOutput = unknown> {
  name: string;
  description: string;
  mode: ToolMode;
  /**
   * Validates the model's arguments before anything is executed.
   *
   * The input side is `unknown` because parsing is the point: the model sends
   * arbitrary JSON, and schemas with defaults legitimately produce a different
   * type than they accept.
   */
  schema: z.ZodType<TInput, z.ZodTypeDef, unknown>;
  /** JSON Schema handed to the provider so the model knows the shape. */
  jsonSchema: Record<string, unknown>;
  execute: (context: ToolContext, input: TInput) => Promise<TOutput>;
  /** One line for the ledger. Must never contain file contents or secrets. */
  summarise?: (input: TInput, output: TOutput) => string;
}

export type ToolResult<TOutput = unknown> =
  | { ok: true; output: TOutput; summary: string; durationMs: number }
  | { ok: false; error: string; code: ToolErrorCode; durationMs: number };

export type ToolErrorCode =
  | "unknown_tool"
  | "not_permitted"
  | "invalid_arguments"
  | "execution_failed";

export class ToolError extends Error {
  constructor(
    readonly code: ToolErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ToolError";
  }
}
