import { DeploymentError, type DeployErrorCode, type ProviderKey } from "../types";

/**
 * Shared HTTP behaviour for host clients.
 *
 * `fetch` is injectable so every provider's request shape, auth header and
 * error classification is testable without a network — which matters more here
 * than elsewhere, because a wrong header against a real deploy API creates or
 * destroys infrastructure on a customer's account.
 */
export abstract class BaseDeploymentProvider {
  constructor(
    protected readonly accessToken: string,
    protected readonly fetchImpl: typeof fetch = fetch,
  ) {}

  abstract readonly key: ProviderKey;

  protected classify(status: number): DeployErrorCode {
    if (status === 401) return "unauthorised";
    if (status === 403) return "forbidden";
    if (status === 404) return "not_found";
    if (status === 422 || status === 400) return "invalid_config";
    if (status === 402) return "quota_exceeded";
    if (status === 429) return "rate_limited";
    return "upstream";
  }

  protected fail(status: number, detail?: string): never {
    const code = this.classify(status);
    // `detail` is kept on the error for the log, not for the user.
    throw new DeploymentError(code, detail ? `${code}: ${detail}` : code, this.key);
  }

  /**
   * Retries only idempotent reads, and only on 429 or 5xx. A failed POST is
   * never retried: on a deploy API that risks creating two deployments from
   * one request.
   */
  protected async request<T>(
    url: string,
    init: RequestInit & { retry?: boolean } = {},
  ): Promise<T> {
    const { retry = false, ...rest } = init;
    const maxAttempts = retry ? 3 : 1;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const response = await this.fetchImpl(url, {
        ...rest,
        headers: { ...this.headers(), ...(rest.headers ?? {}) },
      });

      if (response.ok) {
        const text = await response.text();
        return (text ? JSON.parse(text) : {}) as T;
      }

      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt === maxAttempts - 1) {
        const detail = await response.text().catch(() => "");
        this.fail(response.status, detail.slice(0, 300));
      }

      const retryAfter = Number(response.headers.get("Retry-After"));
      const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 500;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    this.fail(500);
  }

  protected headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.accessToken}`,
      "Content-Type": "application/json",
    };
  }
}
