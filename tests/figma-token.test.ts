import { describe, expect, it } from "vitest";
import { FigmaTokenError, verifyPersonalToken } from "@/lib/figma/personal-token";

/**
 * Connecting with a personal access token.
 *
 * The OAuth app is published privately, so it is visible only to the
 * organization that owns it and every other Figma account is told it does not
 * exist. This path works for any account without Figma's review.
 */
const VALID = `figd_${"a".repeat(40)}`;

function respond(status: number, body: unknown): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
}

describe("personal access token", () => {
  it("accepts a token Figma recognises, and reports the account", async () => {
    const account = await verifyPersonalToken(VALID, respond(200, { id: "123", handle: "tanvir" }));
    expect(account).toEqual({ id: "123", handle: "tanvir" });
  });

  it("falls back to the email when the account has no handle", async () => {
    const account = await verifyPersonalToken(VALID, respond(200, { id: "1", email: "a@b.com" }));
    expect(account.handle).toBe("a@b.com");
  });

  /** Checked before a network call, so an obvious paste error costs nothing. */
  it("rejects anything not shaped like a Figma token", async () => {
    for (const token of ["", "   ", "not-a-token", "sk-ant-123", "figd_short"]) {
      await expect(verifyPersonalToken(token, respond(200, { id: "1" })), token).rejects.toThrow(
        FigmaTokenError,
      );
    }
  });

  it("names the prefix so the message is actionable", async () => {
    await expect(verifyPersonalToken("nope", respond(200, { id: "1" }))).rejects.toThrow(/figd_/);
  });

  it("reports a revoked or mistyped token as Figma rejecting it", async () => {
    await expect(verifyPersonalToken(VALID, respond(403, {}))).rejects.toThrow(/rejected that token/i);
    await expect(verifyPersonalToken(VALID, respond(401, {}))).rejects.toThrow(/rejected that token/i);
  });

  /** Storing an unidentifiable token moves the failure to the first import. */
  it("refuses a response that identifies no account", async () => {
    await expect(verifyPersonalToken(VALID, respond(200, { handle: "x" }))).rejects.toThrow(
      /did not identify/i,
    );
  });

  it("does not report a transport failure as a bad token", async () => {
    const failing = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;

    await expect(verifyPersonalToken(VALID, failing)).rejects.toThrow(/couldn't reach Figma/i);
  });
});
