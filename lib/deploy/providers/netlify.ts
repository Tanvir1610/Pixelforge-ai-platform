import { createHash } from "node:crypto";
import { BaseDeploymentProvider } from "./base";
import type {
  DeploymentFile, DeploymentHandle, DeploymentProvider, DeploymentState, DeployTarget, DomainState,
} from "../types";

/**
 * Netlify.
 *
 * Two-phase by design: a digest of SHA-1 hashes is posted first, and Netlify
 * replies with only the files it does not already have. Re-deploying a project
 * where one file changed uploads one file, which is the whole reason the API
 * works this way.
 */
interface NetlifyDeployResponse {
  id: string;
  state?: string;
  ssl_url?: string;
  deploy_ssl_url?: string;
  required?: string[];
  error_message?: string;
}

const STATE_MAP: Record<string, { phase: DeploymentState["phase"]; status: DeploymentState["status"] }> = {
  new: { phase: "queued", status: "queued" },
  uploading: { phase: "uploading", status: "running" },
  uploaded: { phase: "building", status: "running" },
  preparing: { phase: "building", status: "running" },
  building: { phase: "building", status: "running" },
  processing: { phase: "deploying", status: "running" },
  ready: { phase: "live", status: "completed" },
  error: { phase: "failed", status: "failed" },
};

/** Netlify keys files by SHA-1, not by content hash of our choosing. */
export function sha1(content: string): string {
  return createHash("sha1").update(content, "utf8").digest("hex");
}

export class NetlifyProvider extends BaseDeploymentProvider implements DeploymentProvider {
  readonly key = "netlify" as const;
  readonly displayName = "Netlify";

  async deploy(files: DeploymentFile[], target: DeployTarget): Promise<DeploymentHandle> {
    // Netlify expects paths rooted at "/".
    const digest: Record<string, string> = {};
    const byPath = new Map<string, string>();
    for (const file of files) {
      const key = file.path.startsWith("/") ? file.path : `/${file.path}`;
      digest[key] = sha1(file.content);
      byPath.set(digest[key], file.content);
    }

    const site = encodeURIComponent(target.accountId ?? target.projectName);
    const created = await this.request<NetlifyDeployResponse>(
      `https://api.netlify.com/api/v1/sites/${site}/deploys`,
      {
        method: "POST",
        body: JSON.stringify({
          files: digest,
          draft: target.environment !== "production",
          function_schedules: [],
        }),
      },
    );

    // Only the files Netlify is missing are sent, keyed by hash.
    for (const required of created.required ?? []) {
      const content = byPath.get(required);
      if (content === undefined) continue;

      const path = Object.keys(digest).find((key) => digest[key] === required);
      if (!path) continue;

      await this.request(
        `https://api.netlify.com/api/v1/deploys/${created.id}/files${path}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/octet-stream" },
          body: content,
        },
      );
    }

    return {
      providerDeploymentId: created.id,
      url: created.deploy_ssl_url ?? created.ssl_url,
    };
  }

  /**
   * Netlify attaches a domain by updating the site's alias list, and always
   * verifies by CNAME to the site's own hostname — there is no per-domain
   * challenge to read back, so the record is constructed rather than fetched.
   */
  async addDomain(domain: string, target: DeployTarget): Promise<DomainState> {
    const site = encodeURIComponent(target.accountId ?? target.projectName);
    const response = await this.request<{ domain_aliases?: string[]; name?: string; ssl_url?: string }>(
      `https://api.netlify.com/api/v1/sites/${site}`,
      { method: "GET", retry: true },
    );

    const aliases = new Set(response.domain_aliases ?? []);
    aliases.add(domain);

    await this.request(`https://api.netlify.com/api/v1/sites/${site}`, {
      method: "PATCH",
      body: JSON.stringify({ domain_aliases: [...aliases] }),
    });

    return {
      status: "pending",
      verification: {
        type: "CNAME",
        name: domain,
        value: `${response.name ?? target.projectName}.netlify.app`,
      },
    };
  }

  async checkDomain(domain: string, target: DeployTarget): Promise<DomainState> {
    const site = encodeURIComponent(target.accountId ?? target.projectName);
    const response = await this.request<{ domain_aliases?: string[]; ssl_url?: string }>(
      `https://api.netlify.com/api/v1/sites/${site}`,
      { method: "GET", retry: true },
    );

    const attached = (response.domain_aliases ?? []).includes(domain);
    if (!attached) return { status: "failed", errorMessage: "The domain is no longer attached to this site." };

    // SSL is only provisioned once DNS resolves, so its presence is the signal
    // that verification actually succeeded.
    const secured = Boolean(response.ssl_url && response.ssl_url.includes(domain));
    return secured ? { status: "verified" } : { status: "verifying" };
  }

  async removeDomain(domain: string, target: DeployTarget): Promise<void> {
    const site = encodeURIComponent(target.accountId ?? target.projectName);
    const response = await this.request<{ domain_aliases?: string[] }>(
      `https://api.netlify.com/api/v1/sites/${site}`,
      { method: "GET", retry: true },
    );

    await this.request(`https://api.netlify.com/api/v1/sites/${site}`, {
      method: "PATCH",
      body: JSON.stringify({
        domain_aliases: (response.domain_aliases ?? []).filter((alias) => alias !== domain),
      }),
    });
  }

  async getState(handle: DeploymentHandle): Promise<DeploymentState> {
    const response = await this.request<NetlifyDeployResponse>(
      `https://api.netlify.com/api/v1/deploys/${handle.providerDeploymentId}`,
      { method: "GET", retry: true },
    );

    const mapped = STATE_MAP[response.state ?? ""] ?? { phase: "building" as const, status: "running" as const };

    return {
      ...mapped,
      url: response.ssl_url ?? response.deploy_ssl_url ?? handle.url,
      errorMessage: response.error_message,
    };
  }
}
