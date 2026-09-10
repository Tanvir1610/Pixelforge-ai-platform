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
  it("defaults to the legacy scope nearly every app carries", () => {
    delete process.env.FIGMA_OAUTH_SCOPE;
    expect(figmaScope()).toBe("file_read");
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
    expect(figmaScope()).toBe("file_read");

    process.env.FIGMA_OAUTH_SCOPE = ",,,";
    expect(figmaScope()).toBe("file_read");
  });
});
