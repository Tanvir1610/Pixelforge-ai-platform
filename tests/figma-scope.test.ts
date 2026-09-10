import { afterEach, describe, expect, it } from "vitest";
import { figmaScope } from "@/lib/figma/oauth";

/**
 * A wrong scope is invisible until Figma refuses it, on its own page, with
 * `{"status":400,"message":"Invalid scopes for app"}` that this app never sees.
 */
const original = process.env.FIGMA_OAUTH_SCOPE;

afterEach(() => {
  if (original === undefined) delete process.env.FIGMA_OAUTH_SCOPE;
  else process.env.FIGMA_OAUTH_SCOPE = original;
});

describe("Figma scope", () => {
  /**
   * `file_read` is deprecated for OAuth 2 tokens and `files:read` is deprecated
   * too, so an app registered today carries neither and asking for one is
   * refused outright.
   */
  it("defaults to the granular scopes the app's calls actually need", () => {
    delete process.env.FIGMA_OAUTH_SCOPE;
    expect(figmaScope()).toBe("file_content:read current_user:read");
  });

  it("does not default to a deprecated scope name", () => {
    delete process.env.FIGMA_OAUTH_SCOPE;
    expect(figmaScope()).not.toMatch(/file_read/);
    expect(figmaScope()).not.toMatch(/files:read/);
  });

  it("passes a configured scope through", () => {
    process.env.FIGMA_OAUTH_SCOPE = "files:read";
    expect(figmaScope()).toBe("files:read");
  });

  /** Figma wants spaces; commas are the obvious thing to type and fail identically. */
  it("normalises separators to spaces", () => {
    process.env.FIGMA_OAUTH_SCOPE = "files:read,current_user:read";
    expect(figmaScope()).toBe("files:read current_user:read");

    process.env.FIGMA_OAUTH_SCOPE = "  files:read   current_user:read  ";
    expect(figmaScope()).toBe("files:read current_user:read");
  });

  it("falls back rather than sending an empty scope", () => {
    process.env.FIGMA_OAUTH_SCOPE = "   ";
    expect(figmaScope()).toBe("file_content:read current_user:read");

    process.env.FIGMA_OAUTH_SCOPE = ",,,";
    expect(figmaScope()).toBe("file_content:read current_user:read");
  });
});
