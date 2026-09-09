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
    const response = await this.fetchImpl(`${API}${path}`, {
      headers: this.headers(),
      cache: "no-store",
    });

    if (response.ok) return (await response.json()) as T;

    const retryable = response.status === 429 || response.status >= 500;
    if (retryable && attempt < 3) {
      const retryAfter = Number(response.headers.get("Retry-After"));
      const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 1000;
      await new Promise((resolve) => setTimeout(resolve, delay));
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
    return this.get<FigmaFileResponse>(`/files/${fileKey}?${params}`);
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
    return this.get<FigmaImagesResponse>(`/images/${fileKey}?${params}`);
  }

  /** Fill images referenced by `imageRef` on IMAGE paints. */
  getImageFills(fileKey: string): Promise<{ meta: { images: Record<string, string> } }> {
    return this.get(`/files/${fileKey}/images`);
  }
}
