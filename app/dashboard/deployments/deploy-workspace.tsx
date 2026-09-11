"use client";

import * as React from "react";
import Link from "next/link";
import { useActionState } from "react";
import { Download, ExternalLink, Github, LayoutGrid, Rocket, Upload } from "lucide-react";
import { Banner } from "@/components/ui/banner";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { pushToGitHubAction, type GitHubState } from "@/lib/actions/github";
import type { ProjectRepository } from "@/lib/repositories/github";
import type { Deployment } from "@/types";

/**
 * Deploying.
 *
 * This screen used to run a scripted four-step sequence — Building, Uploading,
 * Deploying, Live — behind a "Deploy to production" button, and finish on a
 * dark panel reading "Your website is live. Deployed to production in 51
 * seconds." above a padlock and `https://northwind.com`. It also reported
 * "Connected as basalt-studio", three environment variables belonging to a
 * domain nobody owns, a verified DNS record with an auto-renewing certificate,
 * and a build log describing a compile that never happened.
 *
 * None of it was real. There is no deployment pipeline in this codebase: no
 * host integration, no build sandbox, nothing that writes a deployment record.
 * A user who clicked that button was told their site was live at an address
 * that was not theirs and did not serve their code.
 *
 * What the product can actually do today is hand over the generated source, so
 * that is what this screen does. The recent-deployments table stays, because it
 * reads real rows and will fill in when a pipeline exists.
 */
const PUSH_INITIAL: GitHubState = {};

export function DeployWorkspace({
  deployments,
  projectId,
  projectName,
  generatedFileCount,
  framework,
  repository = null,
  githubConnected = false,
}: {
  deployments: Deployment[];
  /** Null when the account has no project yet. */
  projectId: string | null;
  projectName: string | null;
  generatedFileCount: number;
  framework: string | null;
  /** Where this project pushes, when a repository has been linked. */
  repository?: ProjectRepository | null;
  /** True when a GitHub account is connected for this workspace. */
  githubConnected?: boolean;
}) {
  const canExport = Boolean(projectId) && generatedFileCount > 0;
  const [pushState, pushAction, pushPending] = useActionState(pushToGitHubAction, PUSH_INITIAL);

  const buildCommand =
    framework === "html" ? "none — static files" : framework === "vue" ? "vite build" : "next build";

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <div className="flex flex-col gap-5">
        <Card>
          <CardHeader
            title="Take your code"
            description="Everything the last generation wrote, as a zip you can run anywhere."
          />
          <CardBody>
            {canExport ? (
              <>
                <p className="text-body-sm text-content-secondary">
                  {generatedFileCount} {generatedFileCount === 1 ? "file" : "files"} from the newest
                  version of {projectName}. Nothing here has been compiled — install dependencies and
                  build it before you ship it.
                </p>
                <a
                  href={`/api/projects/${projectId}/download`}
                  className={buttonClasses("primary", "md", "self-start")}
                >
                  <Download />
                  Download source
                </a>
              </>
            ) : (
              <>
                <p className="text-body-sm text-content-secondary">
                  {projectId
                    ? "This project hasn't generated any code yet, so there's nothing to export."
                    : "Create a project and import a design to get started."}
                </p>
                <Link
                  href={projectId ? "/dashboard/understanding" : "/dashboard/import"}
                  className={buttonClasses("primary", "md", "self-start")}
                >
                  <LayoutGrid />
                  {projectId ? "Generate code" : "Import a design"}
                </Link>
              </>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="GitHub"
            description="One commit per generation, onto the branch you chose."
          />
          <CardBody>
            {!githubConnected ? (
              <>
                <p className="text-body-sm text-content-secondary">
                  Connect a GitHub account and this platform can create a repository and commit each
                  generation to it — which is also the shortest route to a hosted site, since every
                  host deploys from a repo.
                </p>
                <Link href="/dashboard/settings" className={buttonClasses("dark", "md", "self-start")}>
                  <Github />
                  Connect GitHub
                </Link>
              </>
            ) : !repository ? (
              <>
                <p className="text-body-sm text-content-secondary">
                  GitHub is connected. Choose a repository for this project and the generated code can
                  be pushed to it.
                </p>
                <Link href="/dashboard/settings" className={buttonClasses("primary", "md", "self-start")}>
                  Choose a repository
                </Link>
              </>
            ) : (
              <>
                <p className="text-body-sm text-content-secondary">
                  Pushes to{" "}
                  {repository.htmlUrl ? (
                    <a href={repository.htmlUrl} target="_blank" rel="noreferrer noopener" className="font-medium hover:text-accent">
                      {repository.owner}/{repository.name}
                    </a>
                  ) : (
                    <b>{repository.owner}/{repository.name}</b>
                  )}{" "}
                  on {repository.defaultBranch}
                  {repository.lastPushedAt
                    ? `, last pushed ${new Date(repository.lastPushedAt).toLocaleDateString()}.`
                    : ". Nothing pushed yet."}
                </p>

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

                <form action={pushAction}>
                  <input type="hidden" name="projectId" value={projectId ?? ""} />
                  <Button type="submit" variant="primary" loading={pushPending} disabled={!canExport}>
                    <Upload />
                    Push generated code
                  </Button>
                </form>
                {!canExport && (
                  <p className="text-caption text-content-muted">
                    Generate code first — there is nothing to push.
                  </p>
                )}
              </>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Hosting"
            description="What it takes to get this online, and what this platform does not yet do for you."
          />
          <CardBody>
            {/* Was an option group offering Vercel, Netlify and Cloudflare, one
                of which claimed to be connected. None are. */}
            <Banner tone="info">
              One-click hosting isn&apos;t built yet. There is no host integration, no build sandbox and
              nothing that deploys on your behalf — so rather than show a button that does nothing,
              here is what actually works.
            </Banner>

            <ol className="flex flex-col gap-3 text-body-sm">
              <Step index={1}>
                Push to GitHub above, or download the source and put it in a repository yourself.
              </Step>
              <Step index={2}>
                Install and build it locally: <code className="font-mono text-caption">npm install</code> then{" "}
                <code className="font-mono text-caption">{buildCommand}</code>. This is also where you
                find out whether the generated code compiles.
              </Step>
              <Step index={3}>
                Connect that repository to your host. Vercel, Netlify and Cloudflare Pages all deploy a{" "}
                {framework === "html" ? "static site" : "Next.js or Vite project"} straight from a repo,
                and redeploy on every push — including the ones made from here.
              </Step>
            </ol>

            <a
              href="https://vercel.com/docs/deployments/git"
              target="_blank"
              rel="noreferrer noopener"
              className={buttonClasses("secondary", "sm", "self-start")}
            >
              <ExternalLink />
              How Git deployments work
            </a>
          </CardBody>
        </Card>
      </div>

      <div className="flex flex-col gap-5">
        <Card>
          <CardHeader title="Recent deployments" />
          <table className="w-full text-body-sm">
            <caption className="sr-only">Recent deployments for this project</caption>
            <tbody>
              {deployments.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-4 py-6 text-center text-content-muted">
                    Nothing deployed yet. Deployments made through this platform will appear here.
                  </td>
                </tr>
              ) : (
                deployments.map((deployment) => (
                  <tr key={deployment.id}>
                    <td className="border-b border-border px-4 py-3 font-mono text-caption">{deployment.hash}</td>
                    <td className="border-b border-border px-4 py-3">
                      <Badge
                        tone={
                          deployment.status === "ready" ? "success"
                          : deployment.status === "failed" ? "error"
                          : "warning"
                        }
                        dot={deployment.status !== "failed"}
                      >
                        {deployment.status === "ready" ? "Ready"
                          : deployment.status === "failed" ? "Failed"
                          : "Building"}
                      </Badge>
                    </td>
                    <td className="border-b border-border px-4 py-3 text-content-muted">{deployment.time}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </Card>

        <Card>
          <CardHeader title="What now" />
          <CardBody className="gap-2.5">
            {/* Each of these had a button beside it with no handler. They are
                links to screens that exist. */}
            <Next href="/dashboard/import" icon={LayoutGrid} cta="Import">
              Re-import the Figma file when the design changes
            </Next>
            <Next href="/dashboard/understanding" icon={Rocket} cta="Generate">
              Regenerate after editing the design
            </Next>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function Step({ index, children }: { index: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        aria-hidden
        className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-bg-subtle text-[11px] font-semibold text-content-muted"
      >
        {index}
      </span>
      <span className="min-w-0 flex-1 text-content-secondary">{children}</span>
    </li>
  );
}

function Next({ href, icon: Icon, cta, children }: {
  href: string; icon: React.ElementType; cta: string; children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 text-body-sm">
      <Icon aria-hidden className="h-3.5 w-3.5 shrink-0 text-content-muted" />
      <span className="min-w-0 flex-1">{children}</span>
      <Link href={href} className={buttonClasses("ghost", "xs")}>{cta}</Link>
    </div>
  );
}
