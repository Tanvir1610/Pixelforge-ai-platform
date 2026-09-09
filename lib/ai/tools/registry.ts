import "server-only";

import { createServiceClient } from "@/lib/supabase/server";
import { ToolError, type Tool, type ToolContext, type ToolResult } from "./types";

/**
 * Tool registry and dispatcher.
 *
 * Authorisation happens here, once, rather than in each tool. A tool cannot
 * opt out of it, and adding a tool cannot accidentally widen what an agent may
 * do — the context's `allowedModes` is the ceiling.
 */
const tools = new Map<string, Tool<never, unknown>>();

export function registerTool<TInput, TOutput>(tool: Tool<TInput, TOutput>): void {
  tools.set(tool.name, tool as unknown as Tool<never, unknown>);
}

export function getTool(name: string): Tool<never, unknown> | undefined {
  return tools.get(name);
}

/** Tool definitions to advertise to a model, filtered by what it may do. */
export function toolDefinitions(allowedModes: ReadonlySet<string>) {
  return [...tools.values()]
    .filter((tool) => allowedModes.has(tool.mode))
    .map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.jsonSchema,
    }));
}

export function resetTools(): void {
  tools.clear();
}

/** Truncated so one oversized result cannot bloat every row in the ledger. */
function truncate(text: string, limit = 240): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}

/**
 * Executes a tool and records it.
 *
 * Errors are returned rather than thrown: a model calling a tool wrongly is an
 * ordinary event the agent loop should recover from by trying again, not an
 * exception that aborts a whole generation.
 */
export async function executeTool(
  context: ToolContext,
  name: string,
  rawInput: unknown,
): Promise<ToolResult> {
  const started = Date.now();
  const tool = tools.get(name);

  try {
    if (!tool) {
      throw new ToolError("unknown_tool", `There is no tool called "${name}".`);
    }

    if (!context.allowedModes.has(tool.mode)) {
      // The ceiling is the context, not the tool list: a read-only agent that
      // somehow names a write tool is still refused.
      throw new ToolError(
        "not_permitted",
        `"${name}" needs ${tool.mode} access, which this step does not have.`,
      );
    }

    const parsed = tool.schema.safeParse(rawInput);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .slice(0, 5)
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ");
      throw new ToolError("invalid_arguments", `Arguments for "${name}" are invalid — ${issues}`);
    }

    const output = await tool.execute(context, parsed.data as never);
    const summary = tool.summarise
      ? truncate(tool.summarise(parsed.data as never, output))
      : `${name} completed`;
    const durationMs = Date.now() - started;

    await record(context, tool.name, tool.mode, rawInput, "completed", summary, null, durationMs);
    return { ok: true, output, summary, durationMs };
  } catch (error) {
    const durationMs = Date.now() - started;
    const code = error instanceof ToolError ? error.code : "execution_failed";
    const message = error instanceof Error ? error.message : "The tool failed.";

    await record(context, name, tool?.mode ?? "read", rawInput, "failed", null, truncate(message), durationMs);
    return { ok: false, error: message, code, durationMs };
  }
}

/**
 * Writes the ledger row. Arguments are stored, results are not — a result can
 * contain a whole file, and the ledger is for auditing decisions, not content.
 */
async function record(
  context: ToolContext,
  name: string,
  mode: string,
  rawInput: unknown,
  status: "completed" | "failed",
  summary: string | null,
  errorMessage: string | null,
  durationMs: number,
): Promise<void> {
  try {
    const supabase = createServiceClient();
    await supabase.from("ai_tool_calls").insert({
      project_id: context.projectId,
      generation_run_id: context.generationRunId ?? null,
      tool_name: name,
      mode: mode === "write" ? "write" : "read",
      arguments: (rawInput ?? {}) as never,
      result_summary: summary,
      error_message: errorMessage,
      status,
      duration_ms: durationMs,
    });
  } catch {
    // Ledger failures must not abort a generation. The run itself still
    // records success or failure; this row is observability, not control flow.
  }
}
