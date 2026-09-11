"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { z } from "zod";
import { requireOrgRole, requireSession } from "@/lib/auth/session";
import { fieldErrors } from "@/lib/validation/schemas";
import { listProjects } from "@/lib/repositories/projects";
import { getLatestVersionFiles, readFile } from "@/lib/repositories/code";
import {
  getGitHubStatus, getOrgGitHubToken, getProjectRepository, linkRepository,
  recordPush, revokeGitHubConnection, unlinkRepository,
} from "@/lib/repositories/github";
import {
  beginGitHubConnect, githubRedirectUri, isGitHubConfigured, saveGitHubConnection,
} from "@/lib/github/oauth";
import {
  createRepo, getRepo, getViewer, GitHubError, GITHUB_ERROR_COPY, listWritableRepos,
} from "@/lib/github/client";
import { pushFiles, toRepoName } from "@/lib/github/push";
import { checkRateLimit, RATE_LIMITS } from "@/lib/ai/credits";

/**
 * The GitHub integration's actions.
 *
 * Push is the one that matters: it is the reason generated code stops being
 * trapped in this platform. Everything else exists to get a token and a
 * repository in place so that push has somewhere to go.
 */
export interface GitHubState {
  ok?: boolean;
  message?: string;
  errors?: Record<string, string>;
  /** Set on a successful push, so the UI can link to the commit. */
  commitUrl?: string;
}

/** The origin to build the OAuth redirect from. */
async function currentOrigin(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      // Falls through to the request headers below.
    }
  }

  const headerList = await headers();
  const host = headerList.get("host") ?? "localhost:3000";
  const proto = headerList.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/** Starts the OAuth flow. Throws a redirect, so it is never inside a try. */
export async function connectGitHubAction(): Promise<void> {
  const session = await requireOrgRole("developer");

  if (!isGitHubConfigured()) {
    redirect("/dashboard/settings?github_error=not_configured");
  }

  const origin = await currentOrigin();

  let url: string;
  try {
    url = await beginGitHubConnect({
      organizationId: session.organization.id,
      userId: session.user.id,
      origin,
      redirectPath: "/dashboard/settings",
    });
  } catch {
    redirect("/dashboard/settings?github_error=start_failed");
  }

  // Outside the try, because redirect() throws by design.
  redirect(url);
}

/**
 * Connecting with a personal access token.
 *
 * The path that works without an OAuth app at all. Figma's integration needed
 * this because a Private OAuth app is invisible to every other account; here it
 * matters for a different reason — a GitHub OAuth App has exactly one
 * registered callback URL, so an account already using one for sign-in cannot
 * reuse it for this. A fine-grained token needs no app and no review.
 */
const personalTokenSchema = z.object({
  token: z
    .string()
    .trim()
    .min(20, "That doesn't look like a GitHub token.")
    .max(255),
});

export async function connectGitHubTokenAction(
  _prev: GitHubState,
  formData: FormData,
): Promise<GitHubState> {
  const session = await requireOrgRole("developer");

  const parsed = personalTokenSchema.safeParse({ token: formData.get("token") });
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  try {
    // Validated against GitHub before it is stored, so a typo fails here rather
    // than at the first push with a confusing message.
    const viewer = await getViewer(parsed.data.token);

    await saveGitHubConnection({
      organizationId: session.organization.id,
      userId: session.user.id,
      token: { accessToken: parsed.data.token },
      tokenKind: "personal",
    });

    revalidatePath("/dashboard/settings");
    return { ok: true, message: `Connected as @${viewer.login}.` };
  } catch (error) {
    if (error instanceof GitHubError) {
      return {
        message:
          error.code === "unauthorised"
            ? "GitHub rejected that token. Check it was copied in full and hasn't expired."
            : GITHUB_ERROR_COPY[error.code],
      };
    }
    console.error("[github:personal]", error);
    return { message: "Could not reach GitHub to verify that token." };
  }
}

export async function disconnectGitHubAction(
  _prev: GitHubState,
  _formData: FormData,
): Promise<GitHubState> {
  const session = await requireOrgRole("developer");
  await revokeGitHubConnection(session.organization.id, session.user.id);

  revalidatePath("/dashboard/settings");
  return {
    ok: true,
    // Revoked here, not on GitHub: this stops us using it, and only the user
    // can end the token itself. Saying otherwise would leave a live token on
    // their account that they believed was gone.
    message: "GitHub disconnected. Revoke the token on GitHub to end it entirely.",
  };
}

/** Repositories the connected account can push to, for the picker. */
export async function listRepositoriesAction(): Promise<{
  ok: boolean;
  message?: string;
  repos?: { fullName: string; owner: string; name: string; private: boolean; defaultBranch: string }[];
}> {
  const session = await requireSession();
  if (session.demo) return { ok: false, message: "Connect Supabase to use GitHub." };

  const credential = await getOrgGitHubToken(session.organization.id, session.user.id);
  if (!credential) return { ok: false, message: "Connect a GitHub account first." };

  try {
    const repos = await listWritableRepos(credential.token);
    return {
      ok: true,
      repos: repos.map((repo) => ({
        fullName: repo.full_name,
        owner: repo.full_name.split("/")[0],
        name: repo.name,
        private: repo.private,
        defaultBranch: repo.default_branch || "main",
      })),
    };
  } catch (error) {
    if (error instanceof GitHubError) return { ok: false, message: GITHUB_ERROR_COPY[error.code] };
    return { ok: false, message: "Could not reach GitHub." };
  }
}

const linkSchema = z.object({
  projectId: z.string().uuid(),
  /** "owner/name" from the picker, or a new name to create. */
  target: z.string().trim().min(1, "Choose a repository or give a name for a new one."),
  mode: z.enum(["existing", "create"]),
  visibility: z.enum(["private", "public"]).default("private"),
});

/**
 * Points a project at a repository, creating it when asked.
 *
 * The row is only written after GitHub confirms the repository exists and the
 * token can see it. A link to a repository nobody owns would make the push
 * button lie until the moment someone pressed it.
 */
export async function linkRepositoryAction(
  _prev: GitHubState,
  formData: FormData,
): Promise<GitHubState> {
  const session = await requireOrgRole("developer");

  const parsed = linkSchema.safeParse({
    projectId: formData.get("projectId"),
    target: formData.get("target"),
    mode: formData.get("mode"),
    visibility: formData.get("visibility") ?? "private",
  });
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const projects = await listProjects(session, 50);
  const project = projects.find((candidate) => candidate.id === parsed.data.projectId);
  if (!project) return { message: "No such project." };

  const credential = await getOrgGitHubToken(session.organization.id, session.user.id);
  if (!credential) return { message: "Connect a GitHub account first." };

  try {
    let owner: string;
    let name: string;
    let defaultBranch: string;
    let htmlUrl: string | null;
    let createdByUs = false;

    if (parsed.data.mode === "create") {
      const repo = await createRepo(credential.token, {
        name: toRepoName(parsed.data.target),
        description: project.description ?? `Generated from ${project.name} by PixelForge AI`,
        private: parsed.data.visibility === "private",
      });
      owner = repo.full_name.split("/")[0];
      name = repo.name;
      // A repository created with auto_init off has no commits and therefore no
      // branch yet; GitHub still reports the name the first one will take.
      defaultBranch = repo.default_branch || "main";
      htmlUrl = repo.html_url;
      createdByUs = true;
    } else {
      const [rawOwner, rawName] = parsed.data.target.split("/");
      if (!rawOwner || !rawName) return { message: "Give the repository as owner/name." };

      const repo = await getRepo(credential.token, rawOwner, rawName);
      if (!repo) return { message: GITHUB_ERROR_COPY.not_found };
      if (repo.permissions?.push === false) return { message: GITHUB_ERROR_COPY.forbidden };

      owner = repo.full_name.split("/")[0];
      name = repo.name;
      defaultBranch = repo.default_branch || "main";
      htmlUrl = repo.html_url;
    }

    await linkRepository({
      projectId: project.id,
      organizationId: session.organization.id,
      owner,
      name,
      defaultBranch,
      htmlUrl,
      createdByUs,
      userId: session.user.id,
    });

    revalidatePath("/dashboard/settings");
    revalidatePath("/dashboard/deployments");
    return {
      ok: true,
      message:
        parsed.data.mode === "create"
          ? `Created ${owner}/${name}. Push to send the generated code.`
          : `Linked to ${owner}/${name}.`,
    };
  } catch (error) {
    if (error instanceof GitHubError) return { message: GITHUB_ERROR_COPY[error.code] };
    console.error("[github:link]", error);
    return { message: "Could not link the repository." };
  }
}

export async function unlinkRepositoryAction(
  _prev: GitHubState,
  formData: FormData,
): Promise<GitHubState> {
  const session = await requireOrgRole("developer");
  const projectId = String(formData.get("projectId") ?? "");

  const projects = await listProjects(session, 50);
  if (!projects.some((project) => project.id === projectId)) return { message: "No such project." };

  await unlinkRepository(projectId);
  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard/deployments");
  return { ok: true, message: "Repository unlinked. Nothing on GitHub was changed." };
}

const pushSchema = z.object({
  projectId: z.string().uuid(),
  message: z.string().trim().max(500).optional(),
});

/**
 * Pushes the newest generated version.
 *
 * Rate-limited per workspace: this writes to somebody's repository, and a loop
 * would be both a mess in their history and a fast way to meet GitHub's own
 * limits with an account that is not ours.
 */
export async function pushToGitHubAction(
  _prev: GitHubState,
  formData: FormData,
): Promise<GitHubState> {
  const session = await requireOrgRole("developer");

  const parsed = pushSchema.safeParse({
    projectId: formData.get("projectId"),
    message: formData.get("message") ?? undefined,
  });
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const limit = await checkRateLimit(
    `github-push:${session.organization.id}`,
    RATE_LIMITS.githubPush.limit,
    RATE_LIMITS.githubPush.windowSeconds,
  );
  if (!limit.allowed) {
    return { message: `That's a lot of pushes at once. Try again in ${limit.retryAfterSeconds}s.` };
  }

  const projects = await listProjects(session, 50);
  const project = projects.find((candidate) => candidate.id === parsed.data.projectId);
  if (!project) return { message: "No such project." };

  const repository = await getProjectRepository(project.id);
  if (!repository) return { message: "Link a repository before pushing." };

  const credential = await getOrgGitHubToken(session.organization.id, session.user.id);
  if (!credential) return { message: "Connect a GitHub account first." };

  const version = await getLatestVersionFiles(project.id);
  if (!version || version.files.length === 0) {
    return { message: "This project hasn't generated any code yet, so there's nothing to push." };
  }

  // Most files are inline; the ones past the inline threshold are in object
  // storage and are fetched individually.
  const files: { path: string; content: string }[] = [];
  for (const file of version.files) {
    const content = file.content ?? (await readFile(version.versionId, file.path));
    if (content !== null) files.push({ path: file.path, content });
  }

  if (files.length === 0) {
    return { message: "None of this version's files could be read." };
  }

  const commitMessage =
    parsed.data.message?.trim() ||
    `${project.name}: generated v${version.versionNumber}${version.label ? ` (${version.label})` : ""}`;

  try {
    const result = await pushFiles({
      token: credential.token,
      owner: repository.owner,
      repo: repository.name,
      branch: repository.defaultBranch,
      message: commitMessage,
      files,
    });

    await recordPush({
      projectId: project.id,
      organizationId: session.organization.id,
      codeVersionId: version.versionId,
      branch: repository.defaultBranch,
      commitSha: result.commitSha,
      commitMessage,
      fileCount: result.fileCount,
      status: "succeeded",
      userId: session.user.id,
    });

    revalidatePath("/dashboard/settings");
    revalidatePath("/dashboard/deployments");
    revalidatePath(`/project/${project.id}/code`);

    return {
      ok: true,
      commitUrl: result.commitUrl,
      message: `Pushed ${result.fileCount} ${result.fileCount === 1 ? "file" : "files"} to ${repository.owner}/${repository.name}${
        result.createdBranch ? ` on a new ${repository.defaultBranch} branch` : ""
      }.`,
    };
  } catch (error) {
    const message = error instanceof GitHubError ? GITHUB_ERROR_COPY[error.code] : "The push didn't go through.";

    // Recorded, because "it said it failed" is a question that cannot be
    // answered from a table holding only successes.
    await recordPush({
      projectId: project.id,
      organizationId: session.organization.id,
      codeVersionId: version.versionId,
      branch: repository.defaultBranch,
      commitMessage,
      fileCount: files.length,
      status: "failed",
      errorMessage: error instanceof GitHubError ? (error.detail ?? error.message) : String(error),
      userId: session.user.id,
    });

    if (!(error instanceof GitHubError)) console.error("[github:push]", error);
    return { message };
  }
}

/** What the settings screen needs to render the GitHub card. */
export async function loadGitHubPanel(projectId: string | null) {
  const session = await requireSession();

  const [status, repository] = await Promise.all([
    getGitHubStatus(session),
    projectId ? getProjectRepository(projectId) : Promise.resolve(null),
  ]);

  return {
    configured: isGitHubConfigured(),
    status,
    repository,
    // Shown when the connect flow fails, because the single most common cause
    // is a callback URL registered with a different path.
    redirectUri: githubRedirectUri(await currentOrigin()),
  };
}
