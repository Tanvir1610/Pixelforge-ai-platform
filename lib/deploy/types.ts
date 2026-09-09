/**
 * Deployment (§21).
 *
 * One interface, three hosts. Each has a different API shape, a different
 * status vocabulary and a different idea of what an "upload" is, and none of
 * that reaches the orchestrator — which is the same reason the model layer is
 * abstracted.
 */
export type ProviderKey = "vercel" | "netlify" | "cloudflare";

/** Our phases, which the UI renders. Provider states map onto these. */
export type DeploymentPhase =
  | "queued" | "uploading" | "building" | "deploying" | "live" | "failed" | "cancelled";

export type DeploymentStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface DeploymentFile {
  path: string;
  content: string;
}

export interface DeployTarget {
  projectName: string;
  environment: "preview" | "production";
  /** Injected at build time by the host; never written into the file set. */
  environmentVariables?: Record<string, string>;
  buildCommand?: string;
  outputDirectory?: string;
  nodeVersion?: string;
  /** Vercel team id, Netlify account slug, Cloudflare account id. */
  accountId?: string;
}

export interface DeploymentHandle {
  /** The host's own id, used for polling and for deduplication. */
  providerDeploymentId: string;
  /** Present immediately on some hosts, only after build on others. */
  url?: string;
}

export interface DeploymentState {
  phase: DeploymentPhase;
  status: DeploymentStatus;
  url?: string;
  errorMessage?: string;
}

export type DeployErrorCode =
  | "unauthorised" | "forbidden" | "not_found" | "rate_limited"
  | "invalid_config" | "quota_exceeded" | "upstream";

export class DeploymentError extends Error {
  constructor(
    readonly code: DeployErrorCode,
    message: string,
    readonly provider?: ProviderKey,
  ) {
    super(message);
    this.name = "DeploymentError";
  }
}

/**
 * User-facing copy.
 *
 * Host error text is never shown: it leaks internal identifiers, changes
 * without notice, and rarely tells the user what to actually do.
 */
export const DEPLOY_ERROR_COPY: Record<DeployErrorCode, string> = {
  unauthorised: "Your host connection has expired. Reconnect the account and try again.",
  forbidden: "That account doesn't have permission to deploy this project.",
  not_found: "The host couldn't find the target project. Reconnect the account.",
  rate_limited: "The host is rate-limiting deployments. We'll retry shortly.",
  invalid_config: "The build configuration was rejected by the host. Check the build command and output directory.",
  quota_exceeded: "That account has hit its deployment limit for the current plan.",
  upstream: "The host didn't respond as expected. Try again in a moment.",
};

/** What the user must add at their registrar to prove they own a domain. */
export interface DomainVerification {
  type: "TXT" | "CNAME" | "A";
  name: string;
  value: string;
}

export type DomainStatus = "pending" | "verifying" | "verified" | "failed";

export interface DomainState {
  status: DomainStatus;
  verification?: DomainVerification;
  errorMessage?: string;
}

export interface DeploymentProvider {
  readonly key: ProviderKey;
  readonly displayName: string;
  /** Starts a deployment. Returns as soon as the host accepts the files. */
  deploy(files: DeploymentFile[], target: DeployTarget): Promise<DeploymentHandle>;
  /** One poll. The caller owns the loop, so backoff policy lives in one place. */
  getState(handle: DeploymentHandle, target: DeployTarget): Promise<DeploymentState>;
  cancel?(handle: DeploymentHandle, target: DeployTarget): Promise<void>;

  /** Attaches a custom domain and returns what DNS the user must create. */
  addDomain?(domain: string, target: DeployTarget): Promise<DomainState>;
  /** Re-checks a pending domain. Hosts verify asynchronously. */
  checkDomain?(domain: string, target: DeployTarget): Promise<DomainState>;
  removeDomain?(domain: string, target: DeployTarget): Promise<void>;
}
