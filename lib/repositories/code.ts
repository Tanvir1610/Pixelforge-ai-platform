import "server-only";

import { createClient, createServiceClient } from "@/lib/supabase/server";
import {
  carryForward, diffFileSet, isSafePath, type DiffResult, type FileContent, type FileRecord,
} from "@/lib/code/diff";

/**
 * Code version storage.
 *
 * Versions are immutable once written. A generation creates a new one, and a
 * restore copies a previous file set forward rather than deleting anything, so
 * an AI mistake can always be walked back (§27).
 */
const CHUNK = 400;
/** Above this, content goes to object storage rather than inline in the row. */
const INLINE_LIMIT = 64 * 1024;

export interface WriteVersionInput {
  projectId: string;
  files: FileContent[];
  deletions?: string[];
  label?: string;
  summary?: string;
  generationRunId?: string;
}

export interface WriteVersionResult {
  versionId: string;
  versionNumber: number;
  diff: Omit<DiffResult, "records">;
  rejectedPaths: string[];
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size));
  return out;
}

/** File set of a version, keyed by path. */
async function loadVersionFiles(versionId: string) {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("generated_files")
    .select("path, content_hash, content, bytes, language, change_kind")
    .eq("code_version_id", versionId)
    .neq("change_kind", "deleted");

  const map = new Map<string, { hash: string; content: string | null; bytes: number; language: string | null }>();
  for (const row of data ?? []) {
    map.set(row.path, {
      hash: row.content_hash,
      content: row.content,
      bytes: row.bytes,
      language: row.language,
    });
  }
  return map;
}

async function latestVersionId(projectId: string): Promise<string | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("generated_projects")
    .select("id, code_versions(id, version_number)")
    .eq("project_id", projectId)
    .maybeSingle<{ id: string; code_versions: { id: string; version_number: number }[] }>();

  if (!data?.code_versions?.length) return null;
  return [...data.code_versions].sort((a, b) => b.version_number - a.version_number)[0].id;
}

/**
 * Writes a new version.
 *
 * Unsafe paths are dropped and reported rather than silently ignored: a model
 * emitting `../../.env` is a signal worth surfacing, not something to bury.
 */
export async function writeVersion(input: WriteVersionInput): Promise<WriteVersionResult> {
  const supabase = createServiceClient();

  const rejectedPaths = input.files.filter((file) => !isSafePath(file.path)).map((file) => file.path);
  const safeFiles = input.files.filter((file) => isSafePath(file.path));
  const safeDeletions = (input.deletions ?? []).filter(isSafePath);

  const parentId = await latestVersionId(input.projectId);
  const previous = parentId ? await loadVersionFiles(parentId) : new Map();

  const previousHashes = new Map([...previous].map(([path, file]) => [path, file.hash]));
  const diff = diffFileSet(previousHashes, safeFiles, safeDeletions);
  const records = carryForward(previous, diff);

  // create_code_version assigns the number under a lock and checks authorization.
  const { data: versionId, error } = await supabase.rpc("create_code_version", {
    p_project_id: input.projectId,
    p_label: input.label ?? null,
    p_summary: input.summary ?? null,
    p_generation_run_id: input.generationRunId ?? null,
  });

  if (error || !versionId) throw new Error(`Could not create a version: ${error?.message}`);

  const deletedRecords = diff.records.filter((record) => record.changeKind === "deleted");
  const allRecords: FileRecord[] = [...records, ...deletedRecords];

  for (const batch of chunk(allRecords, CHUNK)) {
    const { error: writeError } = await supabase.from("generated_files").insert(
      batch.map((record) => ({
        code_version_id: versionId as string,
        path: record.path,
        content_hash: record.contentHash,
        // Large files live in storage; the row keeps the hash for diffing.
        content: record.content !== null && record.bytes <= INLINE_LIMIT ? record.content : null,
        storage_path: record.bytes > INLINE_LIMIT ? `${input.projectId}/code/${versionId}/${record.path}` : null,
        bytes: record.bytes,
        language: record.language,
        change_kind: record.changeKind,
      })),
    );
    if (writeError) throw new Error(`Could not write files: ${writeError.message}`);
  }

  await supabase.rpc("finalise_code_version", { p_version_id: versionId as string });

  const { data: version } = await supabase
    .from("code_versions")
    .select("version_number")
    .eq("id", versionId as string)
    .single();

  return {
    versionId: versionId as string,
    versionNumber: version?.version_number ?? 1,
    diff: { added: diff.added, modified: diff.modified, deleted: diff.deleted, unchanged: diff.unchanged },
    rejectedPaths,
  };
}

export interface VersionSummary {
  id: string;
  versionNumber: number;
  label: string | null;
  summary: string | null;
  fileCount: number;
  addedCount: number;
  modifiedCount: number;
  deletedCount: number;
  createdAt: string;
}

/** Version history, newest first. Read under the caller's JWT, so RLS applies. */
export async function listVersions(projectId: string, limit = 20): Promise<VersionSummary[]> {
  const supabase = await createClient();
  if (!supabase) return [];

  const { data } = await supabase
    .from("generated_projects")
    .select(
      "code_versions(id, version_number, label, summary, file_count, added_count, modified_count, deleted_count, created_at)",
    )
    .eq("project_id", projectId)
    .maybeSingle<{
      code_versions: {
        id: string; version_number: number; label: string | null; summary: string | null;
        file_count: number; added_count: number; modified_count: number; deleted_count: number;
        created_at: string;
      }[];
    }>();

  return (data?.code_versions ?? [])
    .sort((a, b) => b.version_number - a.version_number)
    .slice(0, limit)
    .map((version) => ({
      id: version.id,
      versionNumber: version.version_number,
      label: version.label,
      summary: version.summary,
      fileCount: version.file_count,
      addedCount: version.added_count,
      modifiedCount: version.modified_count,
      deletedCount: version.deleted_count,
      createdAt: version.created_at,
    }));
}

export async function readFile(versionId: string, path: string): Promise<string | null> {
  const supabase = await createClient();
  if (!supabase) return null;

  const { data } = await supabase
    .from("generated_files")
    .select("content")
    .eq("code_version_id", versionId)
    .eq("path", path)
    .maybeSingle();

  return data?.content ?? null;
}

/** Restores a previous file set as a new version. Never destructive. */
export async function restoreVersion(versionId: string): Promise<string> {
  const supabase = await createClient();
  if (!supabase) throw new Error("Supabase is not configured.");

  const { data, error } = await supabase.rpc("restore_code_version", { p_version_id: versionId });
  if (error) {
    if (error.code === "42501") throw new Error("You do not have permission to restore this project.");
    throw new Error(`Could not restore that version: ${error.message}`);
  }
  return data as string;
}
