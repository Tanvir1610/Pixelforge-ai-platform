import { createHash } from "node:crypto";

/**
 * File-set diffing.
 *
 * Pure and dependency-light, so the rule that decides what counts as a change
 * is unit-testable without a database. Content is hashed rather than compared
 * directly: a version can hold thousands of files and most are untouched
 * between generations, so hashing keeps the write path proportional to what
 * actually changed (§18 — edit, don't regenerate).
 */
export type ChangeKind = "added" | "modified" | "deleted" | "unchanged";

export interface FileContent {
  path: string;
  content: string;
  language?: string;
}

export interface FileRecord {
  path: string;
  contentHash: string;
  content: string | null;
  bytes: number;
  language: string | null;
  changeKind: ChangeKind;
}

export function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/** Byte length, not character count — a multi-byte file is bigger than it looks. */
export function byteLength(content: string): number {
  return Buffer.byteLength(content, "utf8");
}

const EXTENSION_LANGUAGE: Record<string, string> = {
  ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
  css: "css", scss: "scss", html: "html", json: "json", md: "markdown",
  vue: "vue", svg: "svg", yml: "yaml", yaml: "yaml",
};

export function languageFor(path: string): string | null {
  const extension = path.split(".").pop()?.toLowerCase();
  return extension ? (EXTENSION_LANGUAGE[extension] ?? null) : null;
}

/**
 * Rejects paths that would escape the project root.
 *
 * Generated code is untrusted output: a model that emits `../../.env` must not
 * be able to address anything outside the project. Checked here rather than at
 * the storage layer so every write path shares one rule.
 */
export function isSafePath(path: string): boolean {
  if (!path || path.length > 400) return false;
  if (path.startsWith("/") || path.startsWith("\\")) return false;
  if (/^[a-zA-Z]:/.test(path)) return false;
  if (path.includes("\0")) return false;

  const segments = path.split("/");
  return segments.every((segment) => segment !== ".." && segment !== "." && segment.trim() !== "");
}

export interface DiffResult {
  records: FileRecord[];
  added: number;
  modified: number;
  deleted: number;
  unchanged: number;
}

/**
 * Compares an incoming file set against the previous version.
 *
 * `deletions` are explicit rather than inferred from absence: a generation that
 * only touches two files must not be read as deleting everything else.
 */
export function diffFileSet(
  previous: Map<string, string>,
  incoming: FileContent[],
  deletions: string[] = [],
): DiffResult {
  const records: FileRecord[] = [];
  let added = 0;
  let modified = 0;
  let unchanged = 0;

  for (const file of incoming) {
    const hash = hashContent(file.content);
    const previousHash = previous.get(file.path);

    const changeKind: ChangeKind =
      previousHash === undefined ? "added" : previousHash === hash ? "unchanged" : "modified";

    if (changeKind === "added") added += 1;
    else if (changeKind === "modified") modified += 1;
    else unchanged += 1;

    records.push({
      path: file.path,
      contentHash: hash,
      content: file.content,
      bytes: byteLength(file.content),
      language: file.language ?? languageFor(file.path),
      changeKind,
    });
  }

  const incomingPaths = new Set(incoming.map((file) => file.path));
  let deleted = 0;
  for (const path of deletions) {
    // Deleting something that was never there is a no-op, not an error.
    if (!previous.has(path) || incomingPaths.has(path)) continue;
    deleted += 1;
    records.push({
      path,
      contentHash: "",
      content: null,
      bytes: 0,
      language: languageFor(path),
      changeKind: "deleted",
    });
  }

  return { records, added, modified, deleted, unchanged };
}

/**
 * Carries forward files the new version did not touch.
 *
 * A version row is a complete snapshot of the file tree, so reading a version
 * never has to walk the parent chain. Untouched files are copied with their
 * existing hash and marked `unchanged`.
 */
export function carryForward(
  previous: Map<string, { hash: string; content: string | null; bytes: number; language: string | null }>,
  diff: DiffResult,
): FileRecord[] {
  const touched = new Set(diff.records.map((record) => record.path));
  const carried: FileRecord[] = [];

  for (const [path, file] of previous) {
    if (touched.has(path)) continue;
    carried.push({
      path,
      contentHash: file.hash,
      content: file.content,
      bytes: file.bytes,
      language: file.language,
      changeKind: "unchanged",
    });
  }

  return [...diff.records.filter((record) => record.changeKind !== "deleted"), ...carried];
}
