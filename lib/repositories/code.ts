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
  /**
   * The user this version is written on behalf of.
   *
   * Required, because this function writes with the service role: without an
   * actor the database has no one to authorise the write against, and the
   * service role would become a way into any tenant's project.
   */
  actorUserId: string;
}

export interface WriteVersionResult {
  versionId: string;
  versionNumber: number;
  diff: Omit<DiffResult, "records">;
  rejectedPaths: string[];
  /** Paths whose content went to object storage rather than inline in the row. */
  offloadedPaths: string[];
}

/**
 * Object key for a file too big to inline.
 *
 * Content-addressed, not version-addressed. A version is a full snapshot of the
 * tree, so most large files are byte-identical to the previous version's; keying
 * on the hash means carrying one forward costs nothing and needs no copy. The
 * first segment is the project id because that is what the storage policy reads
 * to resolve the owning project — see 0006. Any other shape is an object no
 * policy can authorise.
 */
export function codeObjectPath(projectId: string, contentHash: string): string {
  return `${projectId}/code/${contentHash}`;
}

/** Content lives in storage rather than in the row above this size. */
function isOffloaded(record: FileRecord): boolean {
  return record.changeKind !== "deleted" && record.bytes > INLINE_LIMIT;
}

/**
 * Uploads oversized file contents to `build-artifacts`.
 *
 * Previously the row was written with a storage_path and a null content and
 * nothing ever put an object there, so every generated file over 64 KB came
 * back empty — a silent data loss that only showed up on files large enough to
 * matter.
 *
 * Only records whose content is in hand are uploaded. A carried-forward file
 * already has an object at its hash from the version that first wrote it.
 */
async function offloadLargeFiles(projectId: string, records: FileRecord[]): Promise<string[]> {
  const oversized = records.filter((record) => isOffloaded(record) && record.content !== null);
  if (oversized.length === 0) return [];

  const supabase = createServiceClient();
  const uploaded: string[] = [];

  for (const record of oversized) {
    const { error } = await supabase.storage
      .from("build-artifacts")
      .upload(codeObjectPath(projectId, record.contentHash), Buffer.from(record.content ?? "", "utf8"), {
        contentType: "text/plain; charset=utf-8",
        upsert: true,
      });

    if (error) {
      throw new Error(`Could not store "${record.path}" (${record.bytes} bytes): ${error.message}`);
    }
    uploaded.push(record.path);
  }

  return uploaded;
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

  if (!input.actorUserId) {
    throw new Error("writeVersion requires the user the version is written on behalf of.");
  }

  const rejectedPaths = input.files.filter((file) => !isSafePath(file.path)).map((file) => file.path);
  const safeFiles = input.files.filter((file) => isSafePath(file.path));
  const safeDeletions = (input.deletions ?? []).filter(isSafePath);

  const parentId = await latestVersionId(input.projectId);
  const previous = parentId ? await loadVersionFiles(parentId) : new Map();

  const previousHashes = new Map([...previous].map(([path, file]) => [path, file.hash]));
  const diff = diffFileSet(previousHashes, safeFiles, safeDeletions);
  const records = carryForward(previous, diff);

  // create_code_version assigns the number under a lock and checks authorization.
  // The actor is explicit because this call uses the service role: the function
  // authorises against that user rather than against a JWT it does not have.
  const { data: versionId, error } = await supabase.rpc("create_code_version", {
    p_project_id: input.projectId,
    p_label: input.label ?? null,
    p_summary: input.summary ?? null,
    p_generation_run_id: input.generationRunId ?? null,
    p_actor_id: input.actorUserId,
  });

  if (error || !versionId) {
    if (error?.code === "42501") {
      throw new Error("You do not have permission to write code for this project.");
    }
    throw new Error(`Could not create a version: ${error?.message}`);
  }

  const deletedRecords = diff.records.filter((record) => record.changeKind === "deleted");
  const allRecords: FileRecord[] = [...records, ...deletedRecords];

  // Oversized content is uploaded BEFORE the rows that point at it. A row whose
  // storage_path resolves to nothing is a file that has silently lost its
  // contents, which is worse than a version that failed to write at all.
  const offloadedPaths = await offloadLargeFiles(input.projectId, allRecords);

  for (const batch of chunk(allRecords, CHUNK)) {
    const { error: writeError } = await supabase.from("generated_files").insert(
      batch.map((record) => ({
        code_version_id: versionId as string,
        path: record.path,
        content_hash: record.contentHash,
        // Large files live in storage; the row keeps the hash for diffing.
        content: record.content !== null && record.bytes <= INLINE_LIMIT ? record.content : null,
        storage_path: isOffloaded(record) ? codeObjectPath(input.projectId, record.contentHash) : null,
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
    offloadedPaths,
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

export interface GeneratedFileSummary {
  path: string;
  language: string | null;
  bytes: number;
  content: string | null;
}

export interface LatestCodeVersion {
  versionId: string;
  versionNumber: number;
  label: string | null;
  summary: string | null;
  createdAt: string;
  files: GeneratedFileSummary[];
}

/**
 * The newest version's file set, for the code screen.
 *
 * That screen rendered four fixed files from a fixtures module, so a project
 * that had generated nothing showed a finished Next.js app, and one that had
 * generated something showed the fixtures anyway.
 *
 * Inline content only. A file past the inline limit lives in object storage and
 * is fetched on demand by `readFile`; pulling every one of them here would make
 * opening the screen proportional to the size of the project.
 */
export async function getLatestVersionFiles(projectId: string): Promise<LatestCodeVersion | null> {
  const supabase = await createClient();
  if (!supabase) return null;

  const { data: generated } = await supabase
    .from("generated_projects")
    .select("id, code_versions(id, version_number, label, summary, created_at)")
    .eq("project_id", projectId)
    .maybeSingle<{
      id: string;
      code_versions: {
        id: string; version_number: number; label: string | null;
        summary: string | null; created_at: string;
      }[];
    }>();

  const versions = generated?.code_versions ?? [];
  if (versions.length === 0) return null;

  const latest = [...versions].sort((a, b) => b.version_number - a.version_number)[0];

  const { data: files } = await supabase
    .from("generated_files")
    .select("path, language, bytes, content")
    .eq("code_version_id", latest.id)
    .neq("change_kind", "deleted")
    .order("path");

  return {
    versionId: latest.id,
    versionNumber: latest.version_number,
    label: latest.label,
    summary: latest.summary,
    createdAt: latest.created_at,
    files: (files ?? []).map((file) => ({
      path: file.path,
      language: file.language,
      bytes: file.bytes,
      content: file.content,
    })),
  };
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

/**
 * Reads one file from a version.
 *
 * Inline content is returned directly; anything that was offloaded is fetched
 * from storage. A caller should never have to know which side of the size
 * threshold a file fell on.
 */
export async function readFile(versionId: string, path: string): Promise<string | null> {
  const supabase = await createClient();
  if (!supabase) return null;

  const { data } = await supabase
    .from("generated_files")
    .select("content, storage_path")
    .eq("code_version_id", versionId)
    .eq("path", path)
    .maybeSingle();

  if (!data) return null;
  if (data.content !== null) return data.content;
  if (!data.storage_path) return null;

  // Read under the caller's JWT, so the storage policy still applies.
  const { data: object, error } = await supabase.storage.from("build-artifacts").download(data.storage_path);
  if (error || !object) return null;
  return object.text();
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
