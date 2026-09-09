import type { FigmaFileRef } from "./types";

const FILE_URL = /^https:\/\/(?:www\.)?figma\.com\/(?:design|file|proto)\/([A-Za-z0-9]{10,})(?:\/([^?#]*))?/;

/**
 * Parses a Figma file URL.
 *
 * Strict about the host: `figma.com.evil.test` and `notfigma.com` are rejected,
 * because this value decides which upstream we hand a bearer token to.
 */
export function parseFigmaUrl(input: string): FigmaFileRef | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }

  if (url.protocol !== "https:") return null;
  if (url.hostname !== "figma.com" && url.hostname !== "www.figma.com") return null;

  const match = FILE_URL.exec(url.toString());
  if (!match) return null;

  const rawNodeId = url.searchParams.get("node-id");
  return {
    fileKey: match[1],
    // Figma writes "142-8" in URLs but expects "142:8" in the API.
    nodeId: rawNodeId ? rawNodeId.replace(/-/g, ":") : undefined,
  };
}
