import "server-only";

import type { FigmaFileResponse, FigmaImagesResponse } from "./types";

const API = "https://api.figma.com/v1";

export class FigmaApiError extends Error {
  constructor(
    readonly status: number,
    /** Stable code the UI branches on, so copy never depends on Figma's wording. */
    readonly code: "unauthorised" | "forbidden" | "not_found" | "rate_limited" | "upstream",
    message: string,
  ) {
    super(message);
    this.name = "FigmaApiError";
  }
}

function classify(status: number): FigmaApiError["code"] {
  if (status === 401) return "unauthorised";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  return "upstream";
}

/** User-facing copy. Figma's own messages leak internals and are not shown. */
export const FIGMA_ERROR_COPY: Record<FigmaApiError["code"], string> = {
  unauthorised: "Your Figma connection has expired. Reconnect and try again.",
  forbidden: "We can't open that file. Share it with view access, or connect the account that owns it.",
  not_found: "That Figma file doesn't exist, or the link points at a deleted page.",
  rate_limited: "Figma is rate-limiting us. We'll retry shortly.",
  upstream: "Figma didn't respond as expected. Try again in a moment.",
};

/** Per-request ceiling. Figma is fast; anything past this is not coming back. */
const REQUEST_TIMEOUT_MS = 30_000;
/** Upper bound on an upstream-supplied Retry-After. */
const MAX_RETRY_DELAY_MS = 30_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function backoffMs(attempt: number): number {
  return Math.min(2 ** attempt * 1000, MAX_RETRY_DELAY_MS);
}

/**
 * How long to wait before retrying.
 *
 * `Retry-After` is honoured but clamped: it is a number chosen by the upstream,
 * and an unbounded one ("86400") parks a worker for a day. Past the ceiling we
 * fail fast instead, which the caller can surface and retry later.
 */
export function retryDelayMs(retryAfterHeader: string | null, attempt: number): number {
  const retryAfter = Number(retryAfterHeader);
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(retryAfter * 1000, MAX_RETRY_DELAY_MS);
  }
  return backoffMs(attempt);
}

export interface FigmaClientOptions {
  /** OAuth bearer token, or a personal access token for local development. */
  accessToken: string;
  tokenKind?: "oauth" | "personal";
  fetchImpl?: typeof fetch;
}

/**
 * Thin, typed Figma REST client.
 *
 * Retries only idempotent GETs, and only on 429 or 5xx, honouring Retry-After.
 * Everything else fails fast with a classified error.
 */
export class FigmaClient {
  private readonly accessToken: string;
  private readonly tokenKind: "oauth" | "personal";
  private readonly fetchImpl: typeof fetch;

  constructor({ accessToken, tokenKind = "oauth", fetchImpl = fetch }: FigmaClientOptions) {
    this.accessToken = accessToken;
    this.tokenKind = tokenKind;
    this.fetchImpl = fetchImpl;
  }

  private headers(): Record<string, string> {
    return this.tokenKind === "oauth"
      ? { Authorization: `Bearer ${this.accessToken}` }
      : { "X-Figma-Token": this.accessToken };
  }

  private async get<T>(path: string, attempt = 0): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${API}${path}`, {
        headers: this.headers(),
        cache: "no-store",
        // Without this a hung upstream holds the request forever, and with it a
        // worker and whatever run that worker was serving.
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      if (attempt < 3) {
        await sleep(backoffMs(attempt));
        return this.get<T>(path, attempt + 1);
      }
      throw new FigmaApiError(504, "upstream", FIGMA_ERROR_COPY.upstream);
    }

    if (response.ok) return (await response.json()) as T;

    const retryable = response.status === 429 || response.status >= 500;
    if (retryable && attempt < 3) {
      await sleep(retryDelayMs(response.headers.get("Retry-After"), attempt));
      return this.get<T>(path, attempt + 1);
    }

    const code = classify(response.status);
    throw new FigmaApiError(response.status, code, FIGMA_ERROR_COPY[code]);
  }

  /**
   * Fetches a file. `depth` bounds how far the tree is walked — a full
   * marketing file can be tens of thousands of nodes, and generation only ever
   * needs frames and their contents.
   */
  getFile(fileKey: string, options: { nodeId?: string; depth?: number } = {}): Promise<FigmaFileResponse> {
    const params = new URLSearchParams();
    if (options.nodeId) params.set("ids", options.nodeId);
    if (options.depth) params.set("depth", String(options.depth));
    params.set("geometry", "paths");
    return this.get<FigmaFileResponse>(`/files/${encodeURIComponent(fileKey)}?${params}`);
  }

  /** Renders nodes to images. Figma caps this, so callers must batch. */
  getImages(
    fileKey: string,
    nodeIds: string[],
    options: { format?: "png" | "svg" | "jpg"; scale?: number } = {},
  ): Promise<FigmaImagesResponse> {
    const params = new URLSearchParams({
      ids: nodeIds.join(","),
      format: options.format ?? "png",
      scale: String(options.scale ?? 2),
    });
    return this.get<FigmaImagesResponse>(`/images/${encodeURIComponent(fileKey)}?${params}`);
  }

  /** Fill images referenced by `imageRef` on IMAGE paints. */
  getImageFills(fileKey: string): Promise<{ meta: { images: Record<string, string> } }> {
    return this.get(`/files/${encodeURIComponent(fileKey)}/images`);
  }
}
