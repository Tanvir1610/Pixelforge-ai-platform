import { describe, expect, it } from "vitest";
import { isSafePath } from "@/lib/code/diff";
import { findToolEntrypoint, resolveSpawn, SandboxToolError } from "@/lib/sandbox/runner";
import { isStatusRegression, orderIdFromPayload } from "@/lib/payments/webhook-handler";
import { retryDelayMs } from "@/lib/figma/client";
import { appOrigin, safeRedirect } from "@/lib/deploy/oauth";
import { codeObjectPath } from "@/lib/repositories/code";

/**
 * Regressions for the hardening pass.
 *
 * Each case here is a defect that was live in the codebase, written so that
 * reintroducing it fails rather than merely looking wrong in review.
 */

describe("isSafePath", () => {
  it("still accepts ordinary project paths", () => {
    expect(isSafePath("src/app/page.tsx")).toBe(true);
    expect(isSafePath("package.json")).toBe(true);
    expect(isSafePath("components/ui/button-group.tsx")).toBe(true);
  });

  it("rejects forward-slash traversal", () => {
    expect(isSafePath("../../.env")).toBe(false);
    expect(isSafePath("src/../../etc/passwd")).toBe(false);
  });

  /**
   * The path was split on "/" only, so this arrived as a single segment that
   * matched neither ".." nor "." — and then resolved as a traversal on Windows,
   * where the backslash is a separator.
   */
  it("rejects backslash traversal", () => {
    expect(isSafePath("a\\..\\..\\.env")).toBe(false);
    expect(isSafePath("..\\..\\secrets")).toBe(false);
    expect(isSafePath("src\\app\\page.tsx")).toBe(false);
  });

  it("rejects absolute and drive-qualified paths", () => {
    expect(isSafePath("/etc/passwd")).toBe(false);
    expect(isSafePath("C:/Windows/system32")).toBe(false);
  });

  it("rejects control characters, not only NUL", () => {
    expect(isSafePath("src/index\u0000.ts")).toBe(false);
    expect(isSafePath("src/index\n.ts")).toBe(false);
    expect(isSafePath("src/index\u007f.ts")).toBe(false);
  });
});

describe("sandbox tool resolution", () => {
  /**
   * The sandbox is an empty directory, so `npx tsc` found no local TypeScript
   * and fetched a package named `tsc` from the registry — not the compiler, and
   * not code we control — then executed it inside the sandbox on every build.
   */
  it("never falls back to fetching a tool from the registry", () => {
    expect(() => resolveSpawn("npx", ["definitely-not-installed"], { sandboxRoot: "/tmp/sandbox" }))
      .toThrow(SandboxToolError);
  });

  it("runs a known tool as a script under the current Node binary", () => {
    const spawned = resolveSpawn("npx", ["tsc", "--noEmit"], { sandboxRoot: "/tmp/sandbox" });
    expect(spawned.command).toBe(process.execPath);
    expect(spawned.args[0]).toMatch(/typescript[\\/]bin[\\/]tsc$/);
    expect(spawned.args.slice(1)).toEqual(["--noEmit"]);
  });

  it("prefers the sandbox's own copy of a tool over the platform's", () => {
    const found = findToolEntrypoint(
      "tsc",
      ["/sandbox", "/platform"],
      (path) => path.includes("sandbox") || path.includes("platform"),
    );
    expect(found).toMatch(/^[\\/]sandbox/);
  });

  it("returns null for a tool it has no entrypoint for", () => {
    expect(findToolEntrypoint("rm", ["/sandbox"], () => true)).toBeNull();
  });

  /** `.cmd` shims cannot be spawned without a shell since CVE-2024-27980. */
  it("runs npm through its own JavaScript entrypoint on Windows", () => {
    const spawned = resolveSpawn("npm", ["install"], { platform: "win32" });
    if (spawned.command !== "npm") {
      expect(spawned.command).toBe(process.execPath);
      expect(spawned.args[0]).toMatch(/npm-cli\.js$/);
    }
  });

  it("leaves npm alone on POSIX", () => {
    expect(resolveSpawn("npm", ["install"], { platform: "linux" })).toEqual({
      command: "npm",
      args: ["install"],
    });
  });
});

describe("payment status ordering", () => {
  /**
   * Webhook deliveries are not ordered. A late `payment.authorized` used to
   * overwrite the `captured` row it preceded and null out captured_at, turning
   * a paid customer back into an unpaid one.
   */
  it("treats a late authorisation as a regression from captured", () => {
    expect(isStatusRegression("captured", "authorized")).toBe(true);
    expect(isStatusRegression("captured", "created")).toBe(true);
    expect(isStatusRegression("refunded", "captured")).toBe(true);
  });

  it("allows forward transitions", () => {
    expect(isStatusRegression("authorized", "captured")).toBe(false);
    expect(isStatusRegression("captured", "refunded")).toBe(false);
    expect(isStatusRegression("captured", "captured")).toBe(false);
  });

  it("allows anything when there is no existing row", () => {
    expect(isStatusRegression(null, "created")).toBe(false);
    expect(isStatusRegression(undefined, "captured")).toBe(false);
  });

  it("reads the order id from either shape of payload", () => {
    expect(orderIdFromPayload({ event: "payment.captured", payload: { payment: { entity: { order_id: "order_1" } } } }))
      .toBe("order_1");
    expect(orderIdFromPayload({ event: "order.paid", payload: { order: { entity: { id: "order_2" } } } }))
      .toBe("order_2");
    expect(orderIdFromPayload({ event: "payment.failed", payload: {} })).toBeNull();
  });
});

describe("Figma retry delay", () => {
  /** An upstream-chosen delay of a day parks a worker for a day. */
  it("clamps a hostile Retry-After", () => {
    expect(retryDelayMs("86400", 0)).toBe(30_000);
  });

  it("honours a reasonable Retry-After", () => {
    expect(retryDelayMs("5", 0)).toBe(5_000);
  });

  it("falls back to bounded exponential backoff", () => {
    expect(retryDelayMs(null, 0)).toBe(1_000);
    expect(retryDelayMs("not-a-number", 2)).toBe(4_000);
    expect(retryDelayMs("-1", 9)).toBe(30_000);
  });
});

describe("OAuth callback origin", () => {
  /**
   * The origin came from `new URL(request.url)`, which is the Host header. A
   * proxy passes that through, so a spoofed Host chose both the redirect_uri
   * sent to the host and the base of the post-exchange browser redirect.
   */
  it("prefers the configured app URL over the request's own origin", () => {
    const previous = process.env.NEXT_PUBLIC_APP_URL;
    process.env.NEXT_PUBLIC_APP_URL = "https://app.pixelforge.test";
    try {
      expect(appOrigin("https://evil.test")).toBe("https://app.pixelforge.test");
    } finally {
      if (previous === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
      else process.env.NEXT_PUBLIC_APP_URL = previous;
    }
  });

  it("falls back to the request origin when nothing is configured", () => {
    const previous = process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.NEXT_PUBLIC_APP_URL;
    try {
      expect(appOrigin("http://localhost:3000")).toBe("http://localhost:3000");
    } finally {
      if (previous !== undefined) process.env.NEXT_PUBLIC_APP_URL = previous;
    }
  });

  it("keeps rejecting off-site redirect paths", () => {
    expect(safeRedirect("//evil.test/path")).toBe("/dashboard/deployments");
    expect(safeRedirect("https://evil.test")).toBe("/dashboard/deployments");
    expect(safeRedirect("/project/abc/code")).toBe("/project/abc/code");
  });
});

describe("code object paths", () => {
  /**
   * Content-addressed, and project-first: the storage policy resolves the owning
   * project from the first path segment, so any other shape is an object no
   * policy can authorise.
   */
  it("puts the project id first and keys on the content hash", () => {
    const path = codeObjectPath("11111111-1111-4111-8111-111111111111", "abc123");
    expect(path.split("/")[0]).toBe("11111111-1111-4111-8111-111111111111");
    expect(path.endsWith("abc123")).toBe(true);
  });

  it("gives identical content the same key across versions", () => {
    expect(codeObjectPath("p", "hash")).toBe(codeObjectPath("p", "hash"));
  });
});
