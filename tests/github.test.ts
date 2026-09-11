import { beforeEach, describe, expect, it, vi } from "vitest";
import { pushFiles, toRepoName } from "@/lib/github/push";
import { GitHubError, listWritableRepos } from "@/lib/github/client";

/**
 * The GitHub integration.
 *
 * Every call is made against a fake fetch that asserts what was sent, because
 * the things most likely to be wrong here are wire-level: which endpoint, which
 * parent commit, and whether a failure is recognised as one.
 */
type Route = { status?: number; body?: unknown; headers?: Record<string, string> };

function fakeFetch(routes: Record<string, Route | Route[]>) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const queues = new Map<string, Route[]>();
  for (const [key, value] of Object.entries(routes)) {
    queues.set(key, Array.isArray(value) ? [...value] : [value]);
  }

  const impl = (async (url: string | URL, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const path = String(url).replace("https://api.github.com", "");
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path, body });

    const queue = queues.get(`${method} ${path}`);
    const route = queue && (queue.length > 1 ? queue.shift()! : queue[0]);
    if (!route) {
      return new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });
    }

    return new Response(route.body === undefined ? null : JSON.stringify(route.body), {
      status: route.status ?? 200,
      headers: route.headers,
    });
  }) as unknown as typeof fetch;

  return { impl, calls };
}

const OWNER = "octocat";
const REPO = "acme-site";
const BRANCH = "main";

const EXISTING_REPO_ROUTES = {
  [`GET /repos/${OWNER}/${REPO}/git/ref/heads/${BRANCH}`]: { body: { object: { sha: "parent-sha" } } },
  [`GET /repos/${OWNER}/${REPO}/git/commits/parent-sha`]: {
    body: { sha: "parent-sha", html_url: "u", tree: { sha: "base-tree-sha" } },
  },
  [`POST /repos/${OWNER}/${REPO}/git/trees`]: { body: { sha: "new-tree-sha" } },
  [`POST /repos/${OWNER}/${REPO}/git/commits`]: {
    body: { sha: "new-commit-sha", html_url: "https://github.com/octocat/acme-site/commit/new", tree: { sha: "new-tree-sha" } },
  },
  [`PATCH /repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`]: { body: {} },
};

const FILES = [
  { path: "app/page.tsx", content: "export default function Page() { return null }" },
  { path: "app/globals.css", content: ":root { --x: 1 }" },
];

function push(fetchImpl: typeof fetch, files = FILES) {
  return pushFiles({
    token: "gho_test", owner: OWNER, repo: REPO, branch: BRANCH,
    message: "Generated v1", files, fetchImpl,
  });
}

let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  // The client logs every failure; the tests deliberately cause several.
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  return () => consoleError.mockRestore();
});

describe("pushing to an existing branch", () => {
  it("writes one commit rather than one per file", async () => {
    const { impl, calls } = fakeFetch(EXISTING_REPO_ROUTES);
    await push(impl);

    expect(calls.filter((call) => call.path.endsWith("/git/commits")).length).toBe(1);
    expect(calls.filter((call) => call.path.endsWith("/git/trees")).length).toBe(1);
    // Contents API would be one request per file; blobs would be one per file
    // on top of the tree. Neither should appear.
    expect(calls.some((call) => call.path.includes("/git/blobs"))).toBe(false);
    expect(calls.some((call) => call.path.includes("/contents/"))).toBe(false);
  });

  it("sends file content inline in the tree", async () => {
    const { impl, calls } = fakeFetch(EXISTING_REPO_ROUTES);
    await push(impl);

    const tree = calls.find((call) => call.path.endsWith("/git/trees"))!.body as {
      tree: { path: string; mode: string; type: string; content: string }[];
    };

    expect(tree.tree).toHaveLength(2);
    expect(tree.tree[0]).toMatchObject({ path: "app/page.tsx", mode: "100644", type: "blob" });
    expect(tree.tree[0].content).toContain("export default");
  });

  /**
   * Without base_tree the commit contains only the listed files, so anything
   * the user added to the repository by hand would silently disappear.
   */
  it("layers onto the parent commit's tree", async () => {
    const { impl, calls } = fakeFetch(EXISTING_REPO_ROUTES);
    await push(impl);

    const tree = calls.find((call) => call.path.endsWith("/git/trees"))!.body as { base_tree?: string };
    expect(tree.base_tree).toBe("base-tree-sha");
  });

  it("parents the new commit on the branch head", async () => {
    const { impl, calls } = fakeFetch(EXISTING_REPO_ROUTES);
    await push(impl);

    const commit = calls.find((call) => call.path.endsWith("/git/commits") && call.method === "POST")!.body as {
      parents: string[]; tree: string; message: string;
    };
    expect(commit.parents).toEqual(["parent-sha"]);
    expect(commit.tree).toBe("new-tree-sha");
    expect(commit.message).toBe("Generated v1");
  });

  /** A force push would discard a commit made between our read and our write. */
  it("never force-updates the ref", async () => {
    const { impl, calls } = fakeFetch(EXISTING_REPO_ROUTES);
    await push(impl);

    const update = calls.find((call) => call.method === "PATCH")!.body as { sha: string; force: boolean };
    expect(update.force).toBe(false);
    expect(update.sha).toBe("new-commit-sha");
  });

  it("reports the commit it made", async () => {
    const { impl } = fakeFetch(EXISTING_REPO_ROUTES);
    const result = await push(impl);

    expect(result).toMatchObject({
      commitSha: "new-commit-sha",
      createdBranch: false,
      fileCount: 2,
    });
  });
});

describe("pushing to an empty repository", () => {
  const EMPTY = {
    [`GET /repos/${OWNER}/${REPO}/git/ref/heads/${BRANCH}`]: { status: 404, body: { message: "Not Found" } },
    [`POST /repos/${OWNER}/${REPO}/git/trees`]: { body: { sha: "new-tree-sha" } },
    [`POST /repos/${OWNER}/${REPO}/git/commits`]: {
      body: { sha: "first-sha", html_url: "https://github.com/o/r/commit/first", tree: { sha: "new-tree-sha" } },
    },
    [`POST /repos/${OWNER}/${REPO}/git/refs`]: { body: {} },
  };

  /** A repository created with auto_init off has no ref at all; a 404 is the answer. */
  it("treats a missing branch as a first commit rather than a failure", async () => {
    const { impl } = fakeFetch(EMPTY);
    const result = await push(impl);

    expect(result.createdBranch).toBe(true);
    expect(result.commitSha).toBe("first-sha");
  });

  it("creates the ref instead of patching one that does not exist", async () => {
    const { impl, calls } = fakeFetch(EMPTY);
    await push(impl);

    expect(calls.some((call) => call.method === "PATCH")).toBe(false);
    const create = calls.find((call) => call.path.endsWith("/git/refs") && call.method === "POST")!;
    expect(create.body).toEqual({ ref: "refs/heads/main", sha: "first-sha" });
  });

  it("sends no base_tree and no parent", async () => {
    const { impl, calls } = fakeFetch(EMPTY);
    await push(impl);

    const tree = calls.find((call) => call.path.endsWith("/git/trees"))!.body as { base_tree?: string };
    const commit = calls.find((call) => call.path.endsWith("/git/commits"))!.body as { parents: string[] };

    expect(tree.base_tree).toBeUndefined();
    expect(commit.parents).toEqual([]);
  });
});

describe("refusals", () => {
  it("refuses an empty file set rather than making an empty commit", async () => {
    const { impl } = fakeFetch(EXISTING_REPO_ROUTES);
    await expect(push(impl, [])).rejects.toThrow(/no files/i);
  });

  it("refuses a path that escapes the repository root", async () => {
    const { impl } = fakeFetch(EXISTING_REPO_ROUTES);
    await expect(push(impl, [{ path: "../../etc/passwd", content: "x" }])).rejects.toThrow(/escapes/);
  });

  it("normalises Windows separators, which are not repository paths", async () => {
    const { impl, calls } = fakeFetch(EXISTING_REPO_ROUTES);
    await push(impl, [{ path: "app\\page.tsx", content: "x" }]);

    const tree = calls.find((call) => call.path.endsWith("/git/trees"))!.body as { tree: { path: string }[] };
    expect(tree.tree[0].path).toBe("app/page.tsx");
  });
});

describe("error classification", () => {
  const failing = (status: number, body: unknown, headers?: Record<string, string>) =>
    fakeFetch({
      [`GET /repos/${OWNER}/${REPO}/git/ref/heads/${BRANCH}`]: { status, body, headers },
    }).impl;

  it("calls a 401 an expired connection", async () => {
    await expect(push(failing(401, { message: "Bad credentials" }))).rejects.toMatchObject({
      code: "unauthorised",
    });
  });

  /**
   * A 403 is rate limiting only when the budget is spent. Telling someone to
   * wait when the real problem is that they cannot write to the repository
   * sends them away for an hour to hit the same wall.
   */
  it("separates a spent rate limit from a permissions problem", async () => {
    await expect(
      push(failing(403, { message: "rate limit" }, { "x-ratelimit-remaining": "0" })),
    ).rejects.toMatchObject({ code: "rate_limited" });

    await expect(
      push(failing(403, { message: "Resource not accessible" }, { "x-ratelimit-remaining": "4999" })),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("recognises a name collision, which the user can act on", async () => {
    const { impl } = fakeFetch({
      "POST /user/repos": {
        status: 422,
        body: { message: "Validation Failed", errors: [{ field: "name", message: "name already exists on this account" }] },
      },
    });
    const { createRepo } = await import("@/lib/github/client");

    await expect(createRepo("t", { name: "acme" }, impl)).rejects.toMatchObject({ code: "name_taken" });
  });

  it("keeps GitHub's own wording in the error, out of the user's way", async () => {
    try {
      await push(failing(401, { message: "Bad credentials" }));
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(GitHubError);
      expect((error as GitHubError).detail).toContain("Bad credentials");
      expect((error as GitHubError).message).not.toContain("Bad credentials");
    }
  });
});

describe("listing repositories", () => {
  /** Offering a repository the token cannot push to fails at the last step. */
  it("omits repositories the token cannot push to", async () => {
    const { impl } = fakeFetch({
      "GET /user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member": {
        body: [
          { id: 1, name: "a", full_name: "o/a", private: false, html_url: "", default_branch: "main", permissions: { push: true } },
          { id: 2, name: "b", full_name: "o/b", private: false, html_url: "", default_branch: "main", permissions: { push: false } },
        ],
      },
    });

    const repos = await listWritableRepos("t", impl);
    expect(repos.map((repo) => repo.name)).toEqual(["a"]);
  });
});

describe("toRepoName", () => {
  it("converts a project name into something GitHub will accept unchanged", () => {
    expect(toRepoName("Acme — Marketing Site")).toBe("Acme-Marketing-Site");
    expect(toRepoName("my.project_v2")).toBe("my.project_v2");
  });

  it("trims the separators GitHub would reject at the edges", () => {
    expect(toRepoName("  ...Acme...  ")).toBe("Acme");
  });

  it("always returns something, since a repository needs a name", () => {
    expect(toRepoName("！！！")).toBe("pixelforge-project");
    expect(toRepoName("")).toBe("pixelforge-project");
  });
});
