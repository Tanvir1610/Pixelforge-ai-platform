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

/**
 * Escapes LIKE metacharacters.
 *
 * `%` and `_` are wildcards to Postgres but literal characters to whoever typed
 * the query. Unescaped, a search for "%" matched every file in the version and
 * returned all of them — a whole project's source through a tool meant to
 * return line hits.
 *
 * `*` is dropped rather than escaped: PostgREST rewrites it to `%` while
 * building the filter, after any escaping we could apply, so it is the one
 * metacharacter that cannot be quoted through.
 */
export function escapeLike(query: string): string {
  return query.replace(/\*/g, "").replace(/[\\%_]/g, (character) => `\\${character}`);
}

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
      .ilike("content", `%${escapeLike(input.query)}%`)
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
  /** Set by delete_file. An empty `content` alone is an ambiguous marker. */
  deleted?: boolean;
}

const stagedByRun = new Map<string, Map<string, StagedWrite>>();

/**
 * Bounds on one run's staged set.
 *
 * The stage is an in-process map that outlives the step that filled it, so an
 * agent looping on write_file could grow it until the process died — and a
 * failed run left its entry behind for the lifetime of the server. These are
 * generous against any real project and cheap against a runaway one.
 */
const MAX_STAGED_FILES = 2_000;
const MAX_STAGED_BYTES = 32 * 1024 * 1024;
/**
 * How many runs' stages to keep at once.
 *
 * `clearStagedWrites` exists but nothing calls it, so a run that failed — or
 * simply finished without the orchestrator tidying up — left its whole file set
 * in memory for the lifetime of the process. A stage is only live during its own
 * run, so evicting the oldest beyond this is safe and does not depend on anyone
 * remembering to clean up.
 */
const MAX_TRACKED_RUNS = 16;

function stageKey(context: ToolContext): string {
  return context.generationRunId ?? `${context.projectId}:adhoc`;
}

function stagedBytes(staged: Map<string, StagedWrite>): number {
  let total = 0;
  for (const write of staged.values()) total += Buffer.byteLength(write.content, "utf8");
  return total;
}

/**
 * Stages one write, refusing to grow past the bounds above.
 *
 * The check runs against the set the write would produce, not the set before
 * it, so replacing a file with a smaller one is always allowed even at the
 * ceiling.
 */
function stage(context: ToolContext, write: StagedWrite): Map<string, StagedWrite> {
  const key = stageKey(context);
  const staged = stagedByRun.get(key) ?? new Map<string, StagedWrite>();

  // Re-inserting moves this run to the end of the Map's insertion order, so the
  // eviction below always drops the least recently written to.
  stagedByRun.delete(key);

  while (stagedByRun.size >= MAX_TRACKED_RUNS) {
    const oldest = stagedByRun.keys().next();
    if (oldest.done) break;
    stagedByRun.delete(oldest.value);
  }

  const replacing = staged.get(write.path);
  if (!replacing && staged.size >= MAX_STAGED_FILES) {
    throw new ToolError(
      "not_permitted",
      `This step has already staged ${MAX_STAGED_FILES} files, which is the limit.`,
    );
  }

  const delta =
    Buffer.byteLength(write.content, "utf8") -
    (replacing ? Buffer.byteLength(replacing.content, "utf8") : 0);

  if (delta > 0 && stagedBytes(staged) + delta > MAX_STAGED_BYTES) {
    throw new ToolError(
      "not_permitted",
      `This step has staged more than ${Math.round(MAX_STAGED_BYTES / (1024 * 1024))} MB, which is the limit.`,
    );
  }

  staged.set(write.path, write);
  stagedByRun.set(key, staged);
  return staged;
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
    const staged = stage(context, { path, content: input.content, reason: input.reason });
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
    // `deleted: true` marks the deletion, not the empty content: a write_file of
    // an empty file is a legitimate thing to do and must not be read as a
    // removal.
    stage(context, { path, content: "", reason: "deleted", deleted: true });
    return { path, deleted: true };
  },
  summarise: (input) => `staged deletion of ${input.path}`,
});
