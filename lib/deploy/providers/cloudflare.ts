import { BaseDeploymentProvider } from "./base";
import type {
  DeploymentFile, DeploymentHandle, DeploymentProvider, DeploymentState, DeployTarget, DomainState,
} from "../types";

/**
 * Cloudflare Pages.
 *
 * Direct upload via multipart form data, and every response is wrapped in
 * Cloudflare's `{ success, result, errors }` envelope — a 200 with
 * `success: false` is still a failure, which is easy to miss and produces a
 * deployment that silently never appears.
 */
interface CloudflareEnvelope<T> {
  success: boolean;
  result: T;
  errors?: { code: number; message: string }[];
}

interface CloudflareDeployment {
  id: string;
  url?: string;
  latest_stage?: { name: string; status: string };
}

const STAGE_MAP: Record<string, DeploymentState["phase"]> = {
  queued: "queued",
  initialize: "building",
  clone_repo: "building",
  build: "building",
  deploy: "deploying",
};

export class CloudflareProvider extends BaseDeploymentProvider implements DeploymentProvider {
  readonly key = "cloudflare" as const;
  readonly displayName = "Cloudflare Pages";

  private base(target: DeployTarget): string {
    return `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(target.accountId ?? "")}/pages/projects/${encodeURIComponent(target.projectName)}`;
  }

  /** Unwraps the envelope; a `success: false` body is a failure regardless of status. */
  private unwrap<T>(envelope: CloudflareEnvelope<T>): T {
    if (!envelope.success) {
      const first = envelope.errors?.[0];
      this.fail(first?.code === 10000 ? 401 : 422, first?.message ?? "Cloudflare rejected the request");
    }
    return envelope.result;
  }

  async deploy(files: DeploymentFile[], target: DeployTarget): Promise<DeploymentHandle> {
    const form = new FormData();
    for (const file of files) {
      form.append("file", new Blob([file.content], { type: "text/plain" }), file.path);
    }
    form.append("branch", target.environment === "production" ? "main" : "preview");

    const response = await this.fetchImpl(`${this.base(target)}/deployments`, {
      method: "POST",
      // Content-Type is omitted deliberately: fetch sets the multipart boundary
      // and overriding it produces an unparseable body.
      headers: { Authorization: `Bearer ${this.accessToken}` },
      body: form,
    });

    if (!response.ok) this.fail(response.status, (await response.text().catch(() => "")).slice(0, 300));

    const envelope = (await response.json()) as CloudflareEnvelope<CloudflareDeployment>;
    const result = this.unwrap(envelope);

    return { providerDeploymentId: result.id, url: result.url };
  }

  async addDomain(domain: string, target: DeployTarget): Promise<DomainState> {
    const envelope = await this.request<CloudflareEnvelope<{ name: string; status?: string }>>(
      `${this.base(target)}/domains`,
      { method: "POST", body: JSON.stringify({ name: domain }) },
    );
    this.unwrap(envelope);

    return {
      status: "pending",
      verification: { type: "CNAME", name: domain, value: `${target.projectName}.pages.dev` },
    };
  }

  async checkDomain(domain: string, target: DeployTarget): Promise<DomainState> {
    const envelope = await this.request<CloudflareEnvelope<{ name: string; status?: string }[]>>(
      `${this.base(target)}/domains`,
      { method: "GET", retry: true },
    );

    const domains = this.unwrap(envelope);
    const match = domains.find((entry) => entry.name === domain);

    if (!match) return { status: "failed", errorMessage: "The domain is not attached to this project." };
    if (match.status === "active") return { status: "verified" };
    if (match.status === "blocked" || match.status === "error") {
      return { status: "failed", errorMessage: "Cloudflare could not verify this domain." };
    }
    return { status: "verifying" };
  }

  async removeDomain(domain: string, target: DeployTarget): Promise<void> {
    await this.request(`${this.base(target)}/domains/${encodeURIComponent(domain)}`, { method: "DELETE" });
  }

  async getState(handle: DeploymentHandle, target: DeployTarget): Promise<DeploymentState> {
    const envelope = await this.request<CloudflareEnvelope<CloudflareDeployment>>(
      `${this.base(target)}/deployments/${handle.providerDeploymentId}`,
      { method: "GET", retry: true },
    );

    const result = this.unwrap(envelope);
    const stage = result.latest_stage;

    if (!stage) return { phase: "queued", status: "queued", url: result.url ?? handle.url };

    if (stage.status === "failure") {
      return { phase: "failed", status: "failed", url: result.url ?? handle.url };
    }
    if (stage.status === "canceled") {
      return { phase: "cancelled", status: "cancelled", url: result.url ?? handle.url };
    }
    // Success on the final stage means live; success elsewhere means it moved on.
    if (stage.status === "success" && stage.name === "deploy") {
      return { phase: "live", status: "completed", url: result.url ?? handle.url };
    }

    return {
      phase: STAGE_MAP[stage.name] ?? "building",
      status: "running",
      url: result.url ?? handle.url,
    };
  }
}
