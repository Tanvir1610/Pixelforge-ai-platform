import { BaseDeploymentProvider } from "./base";
import type {
  DeploymentFile, DeploymentHandle, DeploymentProvider, DeploymentState, DeployTarget, DomainState,
} from "../types";

/**
 * Vercel.
 *
 * Files are posted inline with the deployment, which avoids a separate upload
 * round trip. Environment variables go in the request rather than into the file
 * set — writing secrets into generated files would commit them to the version
 * history and hand them to anyone who exports the project.
 */
interface VercelDeploymentResponse {
  id: string;
  url?: string;
  readyState?: string;
  alias?: string[];
}

const STATE_MAP: Record<string, { phase: DeploymentState["phase"]; status: DeploymentState["status"] }> = {
  QUEUED: { phase: "queued", status: "queued" },
  INITIALIZING: { phase: "building", status: "running" },
  BUILDING: { phase: "building", status: "running" },
  UPLOADING: { phase: "uploading", status: "running" },
  DEPLOYING: { phase: "deploying", status: "running" },
  READY: { phase: "live", status: "completed" },
  ERROR: { phase: "failed", status: "failed" },
  CANCELED: { phase: "cancelled", status: "cancelled" },
};

/**
 * Domain attachment.
 *
 * Vercel replies with the exact record to create; it is surfaced verbatim
 * rather than reworded, because a user pasting it into their registrar must get
 * a byte-identical value.
 */
export interface VercelDomainResponse {
  name: string;
  verified?: boolean;
  verification?: { type: string; domain: string; value: string; reason?: string }[];
  error?: { code: string; message: string };
}

export class VercelProvider extends BaseDeploymentProvider implements DeploymentProvider {
  readonly key = "vercel" as const;
  readonly displayName = "Vercel";

  private query(target: DeployTarget): string {
    return target.accountId ? `?teamId=${encodeURIComponent(target.accountId)}` : "";
  }

  async deploy(files: DeploymentFile[], target: DeployTarget): Promise<DeploymentHandle> {
    const response = await this.request<VercelDeploymentResponse>(
      `https://api.vercel.com/v13/deployments${this.query(target)}`,
      {
        method: "POST",
        body: JSON.stringify({
          name: target.projectName,
          files: files.map((file) => ({ file: file.path, data: file.content, encoding: "utf-8" })),
          // Vercel treats a missing target as a preview; production must be explicit.
          target: target.environment === "production" ? "production" : undefined,
          projectSettings: {
            framework: null,
            buildCommand: target.buildCommand ?? null,
            outputDirectory: target.outputDirectory ?? null,
            nodeVersion: target.nodeVersion ?? "20.x",
          },
          env: target.environmentVariables ?? {},
          build: { env: target.environmentVariables ?? {} },
        }),
      },
    );

    return {
      providerDeploymentId: response.id,
      url: response.url ? `https://${response.url}` : undefined,
    };
  }

  async getState(handle: DeploymentHandle, target: DeployTarget): Promise<DeploymentState> {
    const response = await this.request<VercelDeploymentResponse>(
      `https://api.vercel.com/v13/deployments/${handle.providerDeploymentId}${this.query(target)}`,
      { method: "GET", retry: true },
    );

    const mapped = STATE_MAP[response.readyState ?? ""] ?? { phase: "building" as const, status: "running" as const };

    // An alias is the stable production URL; the deployment URL is per-build.
    const alias = response.alias?.[0];
    const url = alias ? `https://${alias}` : response.url ? `https://${response.url}` : handle.url;

    return { ...mapped, url };
  }

  async addDomain(domain: string, target: DeployTarget): Promise<DomainState> {
    const response = await this.request<VercelDomainResponse>(
      `https://api.vercel.com/v10/projects/${encodeURIComponent(target.projectName)}/domains${this.query(target)}`,
      { method: "POST", body: JSON.stringify({ name: domain }) },
    );
    return this.toDomainState(response);
  }

  async checkDomain(domain: string, target: DeployTarget): Promise<DomainState> {
    const response = await this.request<VercelDomainResponse>(
      `https://api.vercel.com/v9/projects/${encodeURIComponent(target.projectName)}/domains/${encodeURIComponent(domain)}${this.query(target)}`,
      { method: "GET", retry: true },
    );
    return this.toDomainState(response);
  }

  async removeDomain(domain: string, target: DeployTarget): Promise<void> {
    await this.request(
      `https://api.vercel.com/v9/projects/${encodeURIComponent(target.projectName)}/domains/${encodeURIComponent(domain)}${this.query(target)}`,
      { method: "DELETE" },
    );
  }

  private toDomainState(response: VercelDomainResponse): DomainState {
    if (response.verified) return { status: "verified" };

    const challenge = response.verification?.[0];
    if (!challenge) {
      // Not verified and no challenge offered means the host is still working
      // it out; reporting "failed" here would send the user chasing a
      // non-problem.
      return { status: "verifying" };
    }

    return {
      status: "pending",
      verification: {
        type: challenge.type === "CNAME" ? "CNAME" : challenge.type === "A" ? "A" : "TXT",
        name: challenge.domain,
        value: challenge.value,
      },
      errorMessage: challenge.reason,
    };
  }

  async cancel(handle: DeploymentHandle, target: DeployTarget): Promise<void> {
    await this.request(
      `https://api.vercel.com/v12/deployments/${handle.providerDeploymentId}/cancel${this.query(target)}`,
      { method: "PATCH" },
    );
  }
}

