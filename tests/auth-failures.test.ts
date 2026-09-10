import { afterEach, describe, expect, it } from "vitest";
import { getPublicEnv, isSupabaseConfigured, resetPublicEnvCache, SupabaseConfigError } from "@/lib/supabase/env";
import { describeAuthFailure } from "@/lib/auth/failure";

/**
 * A misconfigured deployment used to reach the user as "Something broke on our
 * side" and an opaque digest, because the throw happened inside a server action
 * and took the whole route down to the error boundary. These cover the two
 * failures that actually happen on a fresh deployment, and the messages that
 * now name them.
 */

const URL_VAR = "NEXT_PUBLIC_SUPABASE_URL";
const KEY_VAR = "NEXT_PUBLIC_SUPABASE_ANON_KEY";
const VALID_KEY = "a".repeat(40);

function setEnv(url?: string, key?: string) {
  resetPublicEnvCache();
  if (url === undefined) delete process.env[URL_VAR];
  else process.env[URL_VAR] = url;
  if (key === undefined) delete process.env[KEY_VAR];
  else process.env[KEY_VAR] = key;
}

const originalUrl = process.env[URL_VAR];
const originalKey = process.env[KEY_VAR];

afterEach(() => {
  setEnv(originalUrl, originalKey);
});

describe("Supabase configuration", () => {
  it("runs in demo mode when neither variable is set", () => {
    setEnv(undefined, undefined);
    expect(getPublicEnv()).toBeNull();
    expect(isSupabaseConfigured()).toBe(false);
  });

  it("accepts a project API origin", () => {
    setEnv("https://abcdefghijkl.supabase.co", VALID_KEY);
    expect(getPublicEnv()).toEqual({
      [URL_VAR]: "https://abcdefghijkl.supabase.co",
      [KEY_VAR]: VALID_KEY,
    });
  });

  it("tolerates surrounding whitespace, which pasting into a hosting UI adds", () => {
    setEnv("  https://abcdefghijkl.supabase.co  ", `  ${VALID_KEY}  `);
    expect(getPublicEnv()?.[URL_VAR]).toBe("https://abcdefghijkl.supabase.co");
  });

  /** "Partially configured" was true but did not say which half. */
  it("names the missing variable", () => {
    setEnv("https://abcdefghijkl.supabase.co", undefined);
    expect(() => getPublicEnv()).toThrow(/NEXT_PUBLIC_SUPABASE_ANON_KEY is not set/);

    setEnv(undefined, VALID_KEY);
    expect(() => getPublicEnv()).toThrow(/NEXT_PUBLIC_SUPABASE_URL is not set/);
  });

  /**
   * The dashboard address is a valid URL, so it passed validation and failed
   * much later as `TypeError: fetch failed` inside the auth client.
   */
  it("rejects the dashboard URL and says what to use instead", () => {
    setEnv("https://supabase.com/dashboard/project/abcdefghijkl", VALID_KEY);
    expect(() => getPublicEnv()).toThrow(SupabaseConfigError);
    expect(() => getPublicEnv()).toThrow(/<project-ref>\.supabase\.co/);
  });

  it("rejects an origin carrying a path", () => {
    setEnv("https://abcdefghijkl.supabase.co/auth/v1", VALID_KEY);
    expect(() => getPublicEnv()).toThrow(/no path/);
  });

  it("rejects a non-https origin, but allows localhost", () => {
    setEnv("http://abcdefghijkl.supabase.co", VALID_KEY);
    expect(() => getPublicEnv()).toThrow(/must be https/);

    setEnv("http://localhost:54321", VALID_KEY);
    expect(() => getPublicEnv()).not.toThrow();
  });

  it("rejects a key too short to be one", () => {
    setEnv("https://abcdefghijkl.supabase.co", "short");
    expect(() => getPublicEnv()).toThrow(/invalid/i);
  });
});

describe("auth failure messages", () => {
  it("blames the deployment for a configuration fault", () => {
    const failure = describeAuthFailure("sign-up", new SupabaseConfigError("missing"));
    expect(failure.configuration).toBe(true);
    expect(failure.message).toMatch(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  it("recognises a failed fetch, however the runtime words it", () => {
    for (const error of [
      new TypeError("fetch failed"),
      Object.assign(new Error("getaddrinfo ENOTFOUND db.example.supabase.co"), { name: "Error" }),
      Object.assign(new Error("request failed"), { cause: new Error("ECONNREFUSED") }),
    ]) {
      const failure = describeAuthFailure("sign-up", error);
      expect(failure.configuration).toBe(true);
      expect(failure.message).toMatch(/couldn't reach|project's API URL/i);
    }
  });

  it("falls back to a generic message for anything else", () => {
    const failure = describeAuthFailure("sign-up", new Error("something odd"));
    expect(failure.configuration).toBe(false);
    expect(failure.message).toMatch(/try again/i);
    // Never the raw error: it can carry internals.
    expect(failure.message).not.toMatch(/something odd/);
  });
});
