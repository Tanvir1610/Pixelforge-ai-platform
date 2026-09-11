import "server-only";

import { createClient, createServiceClient } from "@/lib/supabase/server";
import type { Session } from "@/lib/auth/session";

/**
 * Reads and writes for the GitHub integration.
 *
 * The token is read with the service role and never leaves the server: the
 * table has no client policy, so there is no path by which a browser session
 * could ask for it even if something here forgot to be careful.
 */
export interface GitHubConnectionStatus {
  login: string;
  isActive: boolean;
  tokenKind: "oauth" | "personal";
  scope: string | null;
  expiresAt: string | null;
}

/** What the UI may know: that a connection exists, and under whose login. */
export async function getGitHubStatus(session: Session): Promise<GitHubConnectionStatus | null> {
  if (session.demo) return null;

  const supabase = await createClient();
  if (!supabase) return null;

  const { data, error } = await supabase.rpc("my_github_connection");
  if (error || !data || data.length === 0) return null;

  const row = data[0] as {
    github_login: string;
    is_active: boolean;
    token_kind: string;
    scope: string | null;
    expires_at: string | null;
  };

  return {
    login: row.github_login,
    isActive: row.is_active,
    tokenKind: row.token_kind === "personal" ? "personal" : "oauth",
    scope: row.scope,
    expiresAt: row.expires_at,
  };
}

export interface GitHubToken {
  token: string;
  login: string;
  tokenKind: "oauth" | "personal";
  scope: string | null;
}

/**
 * The token itself.
 *
 * Service role, and scoped to one organization and user. Anything calling this
 * has already authorised the action; this is not the boundary, it is the read.
 */
export async function getGitHubToken(
  organizationId: string,
  userId: string,
): Promise<GitHubToken | null> {
  const supabase = createServiceClient();

  const { data } = await supabase
    .from("github_connections")
    .select("access_token, github_login, token_kind, scope, expires_at, revoked_at")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .maybeSingle<{
      access_token: string;
      github_login: string;
      token_kind: string;
      scope: string | null;
      expires_at: string | null;
      revoked_at: string | null;
    }>();

  if (!data || data.revoked_at) return null;
  if (data.expires_at && new Date(data.expires_at).getTime() <= Date.now()) return null;

  return {
    token: data.access_token,
    login: data.github_login,
    tokenKind: data.token_kind === "personal" ? "personal" : "oauth",
    scope: data.scope,
  };
}

/**
 * Any live connection in the workspace, preferring the caller's own.
 *
 * A workspace where one person connected GitHub and a colleague generates the
 * code should still be able to push. The connection is held against the
 * organization for exactly this reason; the push is attributed in
 * `github_pushes.pushed_by` so it stays clear who did it.
 */
export async function getOrgGitHubToken(
  organizationId: string,
  preferUserId: string,
): Promise<GitHubToken | null> {
  const own = await getGitHubToken(organizationId, preferUserId);
  if (own) return own;

  const supabase = createServiceClient();
  const { data } = await supabase
    .from("github_connections")
    .select("access_token, github_login, token_kind, scope, expires_at")
    .eq("organization_id", organizationId)
    .is("revoked_at", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle<{
      access_token: string;
      github_login: string;
      token_kind: string;
      scope: string | null;
      expires_at: string | null;
    }>();

  if (!data) return null;
  if (data.expires_at && new Date(data.expires_at).getTime() <= Date.now()) return null;

  return {
    token: data.access_token,
    login: data.github_login,
    tokenKind: data.token_kind === "personal" ? "personal" : "oauth",
    scope: data.scope,
  };
}

export async function revokeGitHubConnection(organizationId: string, userId: string): Promise<void> {
  const supabase = createServiceClient();
  await supabase
    .from("github_connections")
    .update({ revoked_at: new Date().toISOString() })
    .eq("organization_id", organizationId)
    .eq("user_id", userId);
}

export interface ProjectRepository {
  owner: string;
  name: string;
  defaultBranch: string;
  htmlUrl: string | null;
  createdByUs: boolean;
  lastPushedSha: string | null;
  lastPushedAt: string | null;
  lastFileCount: number | null;
}

/** Which repository a project pushes to. Read under the caller's JWT. */
export async function getProjectRepository(projectId: string): Promise<ProjectRepository | null> {
  const supabase = await createClient();
  if (!supabase) return null;

  const { data } = await supabase
    .from("github_repositories")
    .select("owner, name, default_branch, html_url, created_by_us, last_pushed_sha, last_pushed_at, last_file_count")
    .eq("project_id", projectId)
    .maybeSingle<{
      owner: string;
      name: string;
      default_branch: string;
      html_url: string | null;
      created_by_us: boolean;
      last_pushed_sha: string | null;
      last_pushed_at: string | null;
      last_file_count: number | null;
    }>();

  if (!data) return null;

  return {
    owner: data.owner,
    name: data.name,
    defaultBranch: data.default_branch,
    htmlUrl: data.html_url,
    createdByUs: data.created_by_us,
    lastPushedSha: data.last_pushed_sha,
    lastPushedAt: data.last_pushed_at,
    lastFileCount: data.last_file_count,
  };
}

export async function linkRepository(input: {
  projectId: string;
  organizationId: string;
  owner: string;
  name: string;
  defaultBranch: string;
  htmlUrl: string | null;
  createdByUs: boolean;
  userId: string;
}): Promise<void> {
  const supabase = createServiceClient();

  const { error } = await supabase.from("github_repositories").upsert(
    {
      project_id: input.projectId,
      organization_id: input.organizationId,
      owner: input.owner,
      name: input.name,
      default_branch: input.defaultBranch,
      html_url: input.htmlUrl,
      created_by_us: input.createdByUs,
      connected_by: input.userId,
    },
    { onConflict: "project_id" },
  );

  if (error) throw new Error(`Could not link the repository: ${error.message}`);
}

export async function unlinkRepository(projectId: string): Promise<void> {
  const supabase = createServiceClient();
  await supabase.from("github_repositories").delete().eq("project_id", projectId);
}

/**
 * Records what was pushed.
 *
 * Failures are recorded too. "It said it failed but the commit is there" is a
 * question that cannot be answered from a table that only holds successes.
 */
export async function recordPush(input: {
  projectId: string;
  organizationId: string;
  codeVersionId: string | null;
  branch: string;
  commitSha?: string;
  commitMessage?: string;
  fileCount: number;
  status: "succeeded" | "failed";
  errorMessage?: string;
  userId: string;
}): Promise<void> {
  const supabase = createServiceClient();

  await supabase.from("github_pushes").insert({
    project_id: input.projectId,
    organization_id: input.organizationId,
    code_version_id: input.codeVersionId,
    branch: input.branch,
    commit_sha: input.commitSha ?? null,
    commit_message: input.commitMessage ?? null,
    file_count: input.fileCount,
    status: input.status,
    error_message: input.errorMessage ?? null,
    pushed_by: input.userId,
  });

  if (input.status === "succeeded" && input.commitSha) {
    await supabase
      .from("github_repositories")
      .update({
        last_pushed_sha: input.commitSha,
        last_pushed_at: new Date().toISOString(),
        last_file_count: input.fileCount,
      })
      .eq("project_id", input.projectId);
  }
}

export interface PushSummary {
  id: string;
  branch: string;
  commitSha: string | null;
  commitMessage: string | null;
  fileCount: number;
  status: "succeeded" | "failed";
  errorMessage: string | null;
  createdAt: string;
}

export async function listPushes(projectId: string, limit = 10): Promise<PushSummary[]> {
  const supabase = await createClient();
  if (!supabase) return [];

  const { data } = await supabase
    .from("github_pushes")
    .select("id, branch, commit_sha, commit_message, file_count, status, error_message, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(limit)
    .overrideTypes<{
      id: string; branch: string; commit_sha: string | null; commit_message: string | null;
      file_count: number; status: string; error_message: string | null; created_at: string;
    }[]>();

  return (data ?? []).map((row) => ({
    id: row.id,
    branch: row.branch,
    commitSha: row.commit_sha,
    commitMessage: row.commit_message,
    fileCount: row.file_count,
    status: row.status === "failed" ? "failed" : "succeeded",
    errorMessage: row.error_message,
    createdAt: row.created_at,
  }));
}
