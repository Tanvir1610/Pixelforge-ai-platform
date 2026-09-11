"use client";

import * as React from "react";
import { useActionState } from "react";
import { Check, ExternalLink, Github, Plus, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import {
  connectGitHubAction, connectGitHubTokenAction, disconnectGitHubAction,
  linkRepositoryAction, listRepositoriesAction, pushToGitHubAction, unlinkRepositoryAction,
  type GitHubState,
} from "@/lib/actions/github";
import type { GitHubConnectionStatus, ProjectRepository } from "@/lib/repositories/github";

const INITIAL: GitHubState = {};

/**
 * The Repository card.
 *
 * It used to report "basalt-studio/northwind-marketing · Connected · pushes to
 * main on every approved generation" for every account, with no integration
 * behind it — then, after that was removed, an honest "Not connected" with
 * nothing to do about it. This is the integration.
 *
 * Two ways in, for the same reason Figma has two: a GitHub OAuth App registers
 * exactly one callback URL, so an account already using one for sign-in cannot
 * reuse it here. A fine-grained personal access token needs no app at all.
 */
type Method = "oauth" | "token";

export function GitHubPanel({
  configured,
  status,
  repository,
  projectId,
  projectName,
  redirectUri,
  hasGeneratedCode,
  notice,
}: {
  /** GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET are both set. */
  configured: boolean;
  status: GitHubConnectionStatus | null;
  repository: ProjectRepository | null;
  projectId: string | null;
  projectName: string | null;
  /** The exact URI that must be registered on the OAuth app. */
  redirectUri: string;
  hasGeneratedCode: boolean;
  /** Carried back on the callback's query string. */
  notice?: { kind: "connected" | "error"; detail?: string };
}) {
  const [method, setMethod] = React.useState<Method>(configured ? "oauth" : "token");

  const [tokenState, tokenAction, tokenPending] = useActionState(connectGitHubTokenAction, INITIAL);
  const [linkState, linkAction, linkPending] = useActionState(linkRepositoryAction, INITIAL);
  const [unlinkState, unlinkAction, unlinkPending] = useActionState(unlinkRepositoryAction, INITIAL);
  const [pushState, pushAction, pushPending] = useActionState(pushToGitHubAction, INITIAL);
  const [disconnectState, disconnectAction, disconnectPending] = useActionState(disconnectGitHubAction, INITIAL);

  const connected = Boolean(status?.isActive);

  return (
    <Card>
      <CardHeader
        title="Repository"
        description="Push generated code to GitHub as a single commit per generation."
      />
      <CardBody>
        {notice?.kind === "connected" && <Banner tone="success">GitHub connected.</Banner>}
        {disconnectState.message && <Banner tone="info">{disconnectState.message}</Banner>}
        {notice?.kind === "error" && <ConnectError detail={notice.detail} redirectUri={redirectUri} />}

        {connected ? (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-bg-dark text-white">
                <Github aria-hidden className="h-3.5 w-3.5" />
              </span>
              <div className="min-w-[200px] flex-1">
                <b className="block text-body">@{status!.login}</b>
                <span className="text-caption text-content-muted">
                  Connected with {status!.tokenKind === "personal" ? "a personal access token" : "OAuth"}
                  {status!.scope ? ` · ${status!.scope}` : ""}
                </span>
              </div>
              <form action={disconnectAction}>
                <Button type="submit" variant="secondary" size="sm" loading={disconnectPending}>
                  Disconnect
                </Button>
              </form>
            </div>

            {/* Warned rather than discovered at the first push: a token without
                write access authenticates perfectly and then fails at the ref
                update, which is the least useful moment to find out. */}
            {status!.scope !== null && !/repo|public_repo|contents/.test(status!.scope) && (
              <Banner tone="warning">
                That token doesn&apos;t appear to carry repository write access, so a push will be
                refused. Reconnect with the <code className="font-mono">repo</code> scope.
              </Banner>
            )}

            <div className="h-px bg-border" />

            {projectId ? (
              repository ? (
                <LinkedRepository
                  repository={repository}
                  projectId={projectId}
                  hasGeneratedCode={hasGeneratedCode}
                  pushState={pushState}
                  pushAction={pushAction}
                  pushPending={pushPending}
                  unlinkState={unlinkState}
                  unlinkAction={unlinkAction}
                  unlinkPending={unlinkPending}
                />
              ) : (
                <RepositoryPicker
                  projectId={projectId}
                  projectName={projectName ?? ""}
                  state={linkState}
                  action={linkAction}
                  pending={linkPending}
                />
              )
            ) : (
              <p className="text-body-sm text-content-muted">
                Create a project to choose a repository for it.
              </p>
            )}
          </>
        ) : (
          <>
            <p className="text-body-sm text-content-secondary">
              Connect an account and this platform can create a repository and commit each generation
              to it.
            </p>

            {configured && (
              <Segmented
                label="Connection method"
                size="sm"
                className="w-fit"
                value={method}
                onChange={setMethod}
                options={[
                  { value: "oauth", label: "Sign in with GitHub" },
                  { value: "token", label: "Paste a token" },
                ]}
              />
            )}

            {configured && method === "oauth" ? (
              <form action={connectGitHubAction}>
                <Button type="submit" variant="dark">
                  <Github />
                  Connect GitHub
                </Button>
              </form>
            ) : (
              <form action={tokenAction} className="flex flex-col gap-3">
                {!configured && (
                  <Banner tone="info">
                    No GitHub OAuth app is configured on this deployment, so the sign-in flow is
                    unavailable. A personal access token works without one.
                  </Banner>
                )}
                {tokenState.message && (
                  <Banner tone={tokenState.ok ? "success" : "error"}>{tokenState.message}</Banner>
                )}
                <Field
                  label="Personal access token"
                  htmlFor="github-token"
                  error={tokenState.errors?.token}
                  help="Settings → Developer settings → Personal access tokens. It needs repository read and write."
                >
                  <Input
                    id="github-token"
                    name="token"
                    type="password"
                    autoComplete="off"
                    placeholder="github_pat_… or ghp_…"
                    className="font-mono text-caption"
                    required
                  />
                </Field>
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="submit" variant="primary" size="sm" loading={tokenPending}>
                    Connect
                  </Button>
                  <a
                    href="https://github.com/settings/personal-access-tokens/new"
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-1 text-caption text-content-muted hover:text-content"
                  >
                    Create one on GitHub
                    <ExternalLink aria-hidden className="h-3 w-3" />
                  </a>
                </div>
                {/* The token is held for the workspace and never returned to a
                    browser: the table it lands in has no client policy at all. */}
                <p className="text-caption text-content-muted">
                  Stored server-side and never sent back to the browser. Disconnecting stops it being
                  used; revoke it on GitHub to end it entirely.
                </p>
              </form>
            )}
          </>
        )}
      </CardBody>
    </Card>
  );
}

/**
 * What went wrong on the callback.
 *
 * `redirect_uri_mismatch` is by far the likeliest, and it is unfixable without
 * knowing the exact string to register — so the string is printed.
 */
function ConnectError({ detail, redirectUri }: { detail?: string; redirectUri: string }) {
  const mismatch = detail === "redirect_uri_mismatch";
  const notConfigured = detail === "not_configured";

  return (
    <Banner tone="error">
      {notConfigured ? (
        <>GitHub OAuth isn&apos;t configured on this deployment. Use a personal access token instead.</>
      ) : mismatch ? (
        <>
          GitHub refused the callback URL. Register this on the OAuth app, exactly — scheme, host and
          path, no trailing slash:
          <code className="mt-1.5 block break-all font-mono text-caption">{redirectUri}</code>
        </>
      ) : detail === "declined" ? (
        <>The GitHub authorisation was cancelled.</>
      ) : (
        <>
          GitHub rejected the connection{detail ? ` (${detail})` : ""}. If it mentions the redirect
          URI, register this on the app:
          <code className="mt-1.5 block break-all font-mono text-caption">{redirectUri}</code>
        </>
      )}
    </Banner>
  );
}

function LinkedRepository({
  repository, projectId, hasGeneratedCode,
  pushState, pushAction, pushPending,
  unlinkState, unlinkAction, unlinkPending,
}: {
  repository: ProjectRepository;
  projectId: string;
  hasGeneratedCode: boolean;
  pushState: GitHubState;
  pushAction: (formData: FormData) => void;
  pushPending: boolean;
  unlinkState: GitHubState;
  unlinkAction: (formData: FormData) => void;
  unlinkPending: boolean;
}) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-[200px] flex-1">
          <b className="block break-all text-body">
            {repository.htmlUrl ? (
              <a href={repository.htmlUrl} target="_blank" rel="noreferrer noopener" className="hover:text-accent">
                {repository.owner}/{repository.name}
              </a>
            ) : (
              `${repository.owner}/${repository.name}`
            )}
          </b>
          <span className="text-caption text-content-muted">
            Branch {repository.defaultBranch}
            {repository.lastPushedAt
              ? ` · last pushed ${new Date(repository.lastPushedAt).toLocaleDateString()}${
                  repository.lastFileCount ? `, ${repository.lastFileCount} files` : ""
                }`
              : " · nothing pushed yet"}
          </span>
        </div>
        {repository.lastPushedSha && (
          <Badge className="font-mono">{repository.lastPushedSha.slice(0, 7)}</Badge>
        )}
      </div>

      {pushState.message && (
        <Banner tone={pushState.ok ? "success" : "error"}>
          {pushState.message}
          {pushState.commitUrl && (
            <>
              {" "}
              <a href={pushState.commitUrl} target="_blank" rel="noreferrer noopener" className="underline">
                View the commit
              </a>
            </>
          )}
        </Banner>
      )}
      {unlinkState.message && <Banner tone={unlinkState.ok ? "success" : "error"}>{unlinkState.message}</Banner>}

      <form action={pushAction} className="flex flex-col gap-3">
        <input type="hidden" name="projectId" value={projectId} />
        <Field label="Commit message" htmlFor="push-message" help="Leave blank to use the version's own label.">
          <Input id="push-message" name="message" maxLength={500} placeholder="Regenerate from latest design" />
        </Field>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" variant="primary" loading={pushPending} disabled={!hasGeneratedCode}>
            <Upload />
            Push generated code
          </Button>
          {!hasGeneratedCode && (
            <span className="text-caption text-content-muted">Generate code first — there is nothing to push.</span>
          )}
        </div>
      </form>

      <form action={unlinkAction}>
        <input type="hidden" name="projectId" value={projectId} />
        <Button type="submit" variant="ghost" size="sm" loading={unlinkPending}>
          Unlink this repository
        </Button>
      </form>
    </>
  );
}

/** Choosing where the code goes: an existing repository, or a new one. */
function RepositoryPicker({
  projectId, projectName, state, action, pending,
}: {
  projectId: string;
  projectName: string;
  state: GitHubState;
  action: (formData: FormData) => void;
  pending: boolean;
}) {
  const [mode, setMode] = React.useState<"create" | "existing">("create");
  const [repos, setRepos] = React.useState<{ fullName: string }[] | null>(null);
  const [loadingRepos, setLoadingRepos] = React.useState(false);
  const [reposError, setReposError] = React.useState<string | null>(null);

  // Fetched on demand rather than with the page: it is a GitHub call per view,
  // and most visits to this screen are not about choosing a repository.
  async function loadRepos() {
    setLoadingRepos(true);
    setReposError(null);
    const result = await listRepositoriesAction();
    setLoadingRepos(false);
    if (!result.ok) {
      setReposError(result.message ?? "Could not list repositories.");
      return;
    }
    setRepos(result.repos ?? []);
  }

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="mode" value={mode} />

      {state.message && <Banner tone={state.ok ? "success" : "error"}>{state.message}</Banner>}

      <Segmented
        label="Repository"
        size="sm"
        className="w-fit"
        value={mode}
        onChange={(next) => {
          setMode(next);
          if (next === "existing" && repos === null && !loadingRepos) void loadRepos();
        }}
        options={[
          { value: "create", label: "Create a new one" },
          { value: "existing", label: "Use an existing one" },
        ]}
      />

      {mode === "create" ? (
        <>
          <Field
            label="Repository name"
            htmlFor="repo-name"
            error={state.errors?.target}
            help="Created empty and private, so the first push is the whole history."
          >
            <Input
              id="repo-name"
              name="target"
              defaultValue={projectName}
              required
              maxLength={100}
              className="font-mono text-caption"
            />
          </Field>
          <label className="flex items-center gap-2 text-body-sm text-content-secondary">
            <input type="checkbox" name="visibility" value="public" className="h-3.5 w-3.5 accent-[#6366F1]" />
            Make it public
          </label>
        </>
      ) : (
        <Field label="Repository" htmlFor="repo-existing" error={state.errors?.target}>
          {loadingRepos ? (
            <p className="text-body-sm text-content-muted">Loading repositories…</p>
          ) : reposError ? (
            <p className="text-body-sm text-error-text">{reposError}</p>
          ) : repos && repos.length > 0 ? (
            <select
              id="repo-existing"
              name="target"
              required
              className="h-11 w-full rounded-md border border-border bg-bg-surface px-2.5 text-base text-content shadow-sm outline-none focus:border-accent sm:h-[38px] sm:text-body"
            >
              {repos.map((repo) => (
                <option key={repo.fullName} value={repo.fullName}>{repo.fullName}</option>
              ))}
            </select>
          ) : (
            <Input id="repo-existing" name="target" placeholder="owner/name" required className="font-mono text-caption" />
          )}
        </Field>
      )}

      <div>
        <Button type="submit" variant="primary" size="sm" loading={pending}>
          {mode === "create" ? <Plus /> : <Check />}
          {mode === "create" ? "Create repository" : "Link repository"}
        </Button>
      </div>
    </form>
  );
}
