import "server-only";

/**
 * GitHub REST client.
 *
 * Narrow on purpose: this exists to create a repository and write a commit to
 * it, and nothing else. A general-purpose wrapper would be more code to keep
 * correct for endpoints nothing calls.
 *
 * Both OAuth tokens and personal access tokens authenticate with
 * `Authorization: Bearer`, so unlike Figma there is no header to get wrong —
 * but which kind a row holds is still recorded, because only one of them
 * expires and only one can be refreshed.
 */
const API = "https://api.github.com";
const API_VERSION = "2022-11-28";

export type GitHubErrorCode =
  | "unauthorised"
  | "forbidden"
  | "not_found"
  | "rate_limited"
  | "name_taken"
  | "invalid"
  | "upstream";

export class GitHubError extends Error {
  constructor(
    readonly code: GitHubErrorCode,
    message: string,
    /** GitHub's own message, for the log. Never shown to the user verbatim. */
    readonly detail?: string,
  ) {
    super(message);
    this.name = "GitHubError";
  }
}

/**
 * What to tell the user.
 *
 * GitHub's own text leaks endpoint names and internal ids, and "Bad
 * credentials" does not tell someone that they need to reconnect.
 */
export const GITHUB_ERROR_COPY: Record<GitHubErrorCode, string> = {
  unauthorised: "Your GitHub connection is no longer valid. Reconnect the account and try again.",
  forbidden: "That GitHub account doesn't have permission to write to this repository.",
  not_found: "GitHub couldn't find that repository. It may have been renamed, deleted, or made private.",
  rate_limited: "GitHub is rate-limiting this account. Try again in a few minutes.",
  name_taken: "A repository with that name already exists on the account.",
  invalid: "GitHub rejected the request. Check the repository name and branch.",
  upstream: "GitHub didn't respond as expected. Try again in a moment.",
};

interface GitHubErrorBody {
  message?: string;
  errors?: { message?: string; code?: string; field?: string }[];
}

/** Maps a response onto our vocabulary, which the UI has copy for. */
function classify(status: number, body: GitHubErrorBody, headers: Headers): GitHubError {
  const detail = [body.message, ...(body.errors ?? []).map((error) => error.message)]
    .filter(Boolean)
    .join("; ");

  if (status === 401) return new GitHubError("unauthorised", GITHUB_ERROR_COPY.unauthorised, detail);

  if (status === 403 || status === 429) {
    // A 403 is rate limiting only when the budget is actually spent; otherwise
    // it is a permissions problem, and telling someone to wait is useless.
    const remaining = headers.get("x-ratelimit-remaining");
    const retryAfter = headers.get("retry-after");
    const limited = remaining === "0" || retryAfter !== null || status === 429;
    return limited
      ? new GitHubError("rate_limited", GITHUB_ERROR_COPY.rate_limited, detail)
      : new GitHubError("forbidden", GITHUB_ERROR_COPY.forbidden, detail);
  }

  if (status === 404) return new GitHubError("not_found", GITHUB_ERROR_COPY.not_found, detail);

  if (status === 422) {
    // "name already exists on this account" is the one 422 worth its own
    // message, because it is the one a user can act on immediately.
    const taken = (body.errors ?? []).some(
      (error) => error.field === "name" && /already exists/i.test(error.message ?? ""),
    );
    return taken
      ? new GitHubError("name_taken", GITHUB_ERROR_COPY.name_taken, detail)
      : new GitHubError("invalid", GITHUB_ERROR_COPY.invalid, detail);
  }

  return new GitHubError("upstream", GITHUB_ERROR_COPY.upstream, `${status}: ${detail}`);
}

export interface GitHubRequest {
  token: string;
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  path: string;
  body?: unknown;
  /** Injected in tests; never set in application code. */
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

/**
 * One call.
 *
 * Returns null for a 404 on a GET, because "does this ref exist" is a question
 * the push flow asks and an empty repository answering "no" is not an error.
 */
export async function githubFetch<T>(request: GitHubRequest): Promise<T> {
  const fetchImpl = request.fetchImpl ?? fetch;

  const response = await fetchImpl(`${API}${request.path}`, {
    method: request.method ?? "GET",
    headers: {
      Authorization: `Bearer ${request.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": API_VERSION,
      "User-Agent": "PixelForge-AI",
      ...(request.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: request.body === undefined ? undefined : JSON.stringify(request.body),
    signal: request.signal,
    cache: "no-store",
  });

  if (!response.ok) {
    let body: GitHubErrorBody = {};
    try {
      body = (await response.json()) as GitHubErrorBody;
    } catch {
      // A non-JSON error body is itself only worth the status code.
    }
    const error = classify(response.status, body, response.headers);
    console.error("[github]", request.method ?? "GET", request.path, error.code, error.detail);
    throw error;
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/** A GET whose 404 is an answer rather than a failure. */
export async function githubFetchOptional<T>(request: GitHubRequest): Promise<T | null> {
  try {
    return await githubFetch<T>(request);
  } catch (error) {
    if (error instanceof GitHubError && error.code === "not_found") return null;
    throw error;
  }
}

export interface GitHubUser {
  id: number;
  login: string;
  name: string | null;
}

export async function getViewer(token: string, fetchImpl?: typeof fetch): Promise<GitHubUser> {
  return githubFetch<GitHubUser>({ token, path: "/user", fetchImpl });
}

export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  html_url: string;
  default_branch: string;
  permissions?: { push?: boolean; admin?: boolean };
}

/** Repositories the token can actually push to, newest activity first. */
export async function listWritableRepos(
  token: string,
  fetchImpl?: typeof fetch,
): Promise<GitHubRepo[]> {
  const repos = await githubFetch<GitHubRepo[]>({
    token,
    path: "/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member",
    fetchImpl,
  });

  // Listing a repository the user cannot push to would offer them a target
  // that fails at the last step, after the commit has been assembled.
  return repos.filter((repo) => repo.permissions?.push !== false);
}

export async function getRepo(
  token: string,
  owner: string,
  name: string,
  fetchImpl?: typeof fetch,
): Promise<GitHubRepo | null> {
  return githubFetchOptional<GitHubRepo>({ token, path: `/repos/${owner}/${name}`, fetchImpl });
}

export async function createRepo(
  token: string,
  input: { name: string; description?: string; private?: boolean },
  fetchImpl?: typeof fetch,
): Promise<GitHubRepo> {
  return githubFetch<GitHubRepo>({
    token,
    method: "POST",
    path: "/user/repos",
    body: {
      name: input.name,
      description: input.description,
      // Private by default. A user's unreviewed generated code becoming public
      // because of a default is not a mistake they can take back.
      private: input.private ?? true,
      // Created empty, so the first push owns the whole history rather than
      // arriving as a second commit on top of a generated README.
      auto_init: false,
    },
    fetchImpl,
  });
}
