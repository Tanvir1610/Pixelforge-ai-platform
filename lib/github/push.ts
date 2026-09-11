import "server-only";

import { githubFetch, githubFetchOptional, GitHubError } from "./client";

/**
 * Writing a commit through the Git Data API.
 *
 * Not the Contents API, which writes one file per request and would turn a
 * forty-file generation into forty commits. This assembles a single tree and a
 * single commit, so a generation lands as one reviewable change.
 *
 * Tree entries carry their content inline rather than being uploaded as blobs
 * first — the API accepts `content` in place of `sha` — which makes the whole
 * push three requests regardless of file count.
 */
export interface PushFile {
  path: string;
  content: string;
}

export interface PushInput {
  token: string;
  owner: string;
  repo: string;
  branch: string;
  message: string;
  files: PushFile[];
  fetchImpl?: typeof fetch;
}

export interface PushResult {
  commitSha: string;
  commitUrl: string;
  /** True when this push created the branch rather than advancing it. */
  createdBranch: boolean;
  fileCount: number;
}

/**
 * GitHub's documented ceiling for a tree is 100,000 entries; the practical one
 * is request size. Generated projects are source files, so this is a guard
 * against a runaway generation rather than a limit anyone should meet.
 */
const MAX_FILES = 1_000;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;

interface Ref {
  object: { sha: string };
}

interface Commit {
  sha: string;
  html_url: string;
  tree: { sha: string };
}

interface Tree {
  sha: string;
}

/** Paths are repository-relative; anything else is a mistake worth refusing. */
function normalisePath(path: string): string {
  const clean = path.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!clean || clean.split("/").includes("..")) {
    throw new GitHubError("invalid", `Refusing to push a path that escapes the repository: ${path}`);
  }
  return clean;
}

export async function pushFiles(input: PushInput): Promise<PushResult> {
  const { token, owner, repo, branch, fetchImpl } = input;

  if (input.files.length === 0) {
    throw new GitHubError("invalid", "There are no files to push.");
  }
  if (input.files.length > MAX_FILES) {
    throw new GitHubError("invalid", `That version has ${input.files.length} files, which is more than one commit should carry.`);
  }

  const total = input.files.reduce((sum, file) => sum + Buffer.byteLength(file.content, "utf8"), 0);
  if (total > MAX_TOTAL_BYTES) {
    throw new GitHubError("invalid", "That version is too large to push in a single commit.");
  }

  // Where the branch is now. A repository created empty has no ref at all, and
  // a 404 here is the answer rather than a failure.
  const ref = await githubFetchOptional<Ref>({
    token,
    path: `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`,
    fetchImpl,
  });

  const parentSha = ref?.object.sha ?? null;

  // The tree the new one is layered onto. Without a base tree, the commit
  // contains *only* the files listed — so anything the user added to the
  // repository by hand, a licence or a CI workflow, would silently disappear.
  let baseTreeSha: string | undefined;
  if (parentSha) {
    const parent = await githubFetch<Commit>({
      token,
      path: `/repos/${owner}/${repo}/git/commits/${parentSha}`,
      fetchImpl,
    });
    baseTreeSha = parent.tree.sha;
  }

  const tree = await githubFetch<Tree>({
    token,
    method: "POST",
    path: `/repos/${owner}/${repo}/git/trees`,
    body: {
      ...(baseTreeSha ? { base_tree: baseTreeSha } : {}),
      tree: input.files.map((file) => ({
        path: normalisePath(file.path),
        mode: "100644",
        type: "blob",
        content: file.content,
      })),
    },
    fetchImpl,
  });

  const commit = await githubFetch<Commit>({
    token,
    method: "POST",
    path: `/repos/${owner}/${repo}/git/commits`,
    body: {
      message: input.message,
      tree: tree.sha,
      parents: parentSha ? [parentSha] : [],
    },
    fetchImpl,
  });

  // Creating the ref and moving it are different calls, and which one applies
  // depends on whether the branch existed when we started.
  if (parentSha) {
    await githubFetch({
      token,
      method: "PATCH",
      path: `/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`,
      // Never force. If someone pushed between our read and our write, the
      // update is rejected rather than discarding their commit.
      body: { sha: commit.sha, force: false },
      fetchImpl,
    });
  } else {
    await githubFetch({
      token,
      method: "POST",
      path: `/repos/${owner}/${repo}/git/refs`,
      body: { ref: `refs/heads/${branch}`, sha: commit.sha },
      fetchImpl,
    });
  }

  return {
    commitSha: commit.sha,
    commitUrl: commit.html_url,
    createdBranch: parentSha === null,
    fileCount: input.files.length,
  };
}

/**
 * A repository name GitHub will accept.
 *
 * GitHub allows letters, digits, dot, dash and underscore, and silently
 * rewrites anything else — so a project called "Acme — Marketing Site" becomes
 * a name the user did not choose and we did not record. Doing the conversion
 * here means the name we store is the name that exists.
 */
export function toRepoName(projectName: string): string {
  const name = projectName
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 100);

  return name || "pixelforge-project";
}
