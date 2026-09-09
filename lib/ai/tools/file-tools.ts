import "server-only";

import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/server";
import { isSafePath } from "@/lib/code/diff";
import { registerTool } from "./registry";
import { ToolError, type ToolContext } from "./types";

/**
 * File tools.
 *
 * Reads and writes are scoped to the version in `context.codeVersionId`. Paths
 * are validated with the same rule the write path uses, so a model cannot
 * address anything outside the project root by going through a tool.
 */
const pathInput = z.object({ path: z.string().min(1).max(400) });

const writeInput = z.object({
  path: z.string().min(1).max(400),
  content: z.string().max(400_000),
  reason: z.string().max(300).optional().describe("Why this file changed."),
});

const searchInput = z.object({
  query: z.string().min(2).max(200),
  limit: z.number().int().min(1).max(50).default(20),
});

const jsonSchema = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

function requireVersion(context: ToolContext): string {
  if (!context.codeVersionId) {
    throw new ToolError("not_permitted", "No code version is open for this step.");
  }
  return context.codeVersionId;
}

function requireSafePath(path: string): string {
  if (!isSafePath(path)) {
    throw new ToolError("invalid_arguments", `"${path}" is outside the project root.`);
  }
  return path;
}

registerTool({
  name: "list_files",
  description: "Every file path in the current version of the generated project.",
  mode: "read",
  schema: z.object({}),
  jsonSchema: jsonSchema({}),
  async execute(context: ToolContext) {
    const supabase = createServiceClient();
    const { data } = await supabase
      .from("generated_files")
      .select("path, language, bytes")
      .eq("code_version_id", requireVersion(context))
      .neq("change_kind", "deleted")
      .order("path");
    return data ?? [];
  },
  summarise: (_input, output) => `${(output as unknown[]).length} files`,
});

registerTool({
  name: "read_file",
  description: "Read one file from the current version.",
  mode: "read",
  schema: pathInput,
  jsonSchema: jsonSchema({ path: { type: "string" } }, ["path"]),
  async execute(context: ToolContext, input: z.infer<typeof pathInput>) {
    const supabase = createServiceClient();
    const { data } = await supabase
      .from("generated_files")
      .select("content, bytes, language")
      .eq("code_version_id", requireVersion(context))
      .eq("path", requireSafePath(input.path))
      .maybeSingle();

    if (!data) throw new ToolError("execution_failed", `"${input.path}" does not exist in this version.`);
    return data;
  },
  summarise: (input) => `read ${input.path}`,
});

registerTool({
  name: "search_code",
  description: "Find files whose contents mention a string. Use before editing to locate call sites.",
  mode: "read",
  schema: searchInput,
  jsonSchema: jsonSchema(
    { query: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 50 } },
    ["query"],
  ),
  async execute(context: ToolContext, input: z.infer<typeof searchInput>) {
    const supabase = createServiceClient();
    const { data } = await supabase
      .from("generated_files")
      .select("path, content")
      .eq("code_version_id", requireVersion(context))
      .neq("change_kind", "deleted")
      .ilike("content", `%${input.query}%`)
      .limit(input.limit);

    // Return locations, not whole files: the model can read what it needs next,
    // and a search must not blow the context window.
    return (data ?? []).map((file) => ({
      path: file.path,
      matches: (file.content ?? "").split("\n").reduce<{ line: number; text: string }[]>((hits, text, index) => {
        if (hits.length < 5 && text.includes(input.query)) hits.push({ line: index + 1, text: text.trim().slice(0, 200) });
        return hits;
      }, []),
    }));
  },
  summarise: (input, output) => `"${input.query}" found in ${(output as unknown[]).length} files`,
});

/**
 * Staged writes.
 *
 * A write tool does not touch `generated_files` directly. It stages content the
 * orchestrator commits as one version, so a generation is atomic: either the
 * whole file set lands or none of it does, and a crash mid-run cannot leave a
 * half-written project behind.
 */
export interface StagedWrite {
  path: string;
  content: string;
  reason?: string;
}

const stagedByRun = new Map<string, Map<string, StagedWrite>>();

function stageKey(context: ToolContext): string {
  return context.generationRunId ?? `${context.projectId}:adhoc`;
}

export function stagedWrites(context: ToolContext): StagedWrite[] {
  return [...(stagedByRun.get(stageKey(context))?.values() ?? [])];
}

export function clearStagedWrites(context: ToolContext): void {
  stagedByRun.delete(stageKey(context));
}

registerTool({
  name: "write_file",
  description: "Create or replace a file. Changes are staged and committed as one version at the end of the step.",
  mode: "write",
  schema: writeInput,
  jsonSchema: jsonSchema(
    {
      path: { type: "string" },
      content: { type: "string" },
      reason: { type: "string", description: "Why this file changed." },
    },
    ["path", "content"],
  ),
  async execute(context: ToolContext, input: z.infer<typeof writeInput>) {
    const path = requireSafePath(input.path);
    const key = stageKey(context);
    const staged = stagedByRun.get(key) ?? new Map<string, StagedWrite>();
    staged.set(path, { path, content: input.content, reason: input.reason });
    stagedByRun.set(key, staged);
    return { path, bytes: Buffer.byteLength(input.content, "utf8"), staged: staged.size };
  },
  summarise: (input) => `staged ${input.path}${input.reason ? ` — ${input.reason}` : ""}`,
});

registerTool({
  name: "delete_file",
  description: "Remove a file from the project in the next version.",
  mode: "write",
  schema: pathInput,
  jsonSchema: jsonSchema({ path: { type: "string" } }, ["path"]),
  async execute(context: ToolContext, input: z.infer<typeof pathInput>) {
    const path = requireSafePath(input.path);
    const key = stageKey(context);
    const staged = stagedByRun.get(key) ?? new Map<string, StagedWrite>();
    // An empty staged content marks a deletion; the orchestrator separates them.
    staged.set(path, { path, content: "", reason: "deleted" });
    stagedByRun.set(key, staged);
    return { path, deleted: true };
  },
  summarise: (input) => `staged deletion of ${input.path}`,
});
