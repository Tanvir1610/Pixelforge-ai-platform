import { describe, expect, it, vi } from "vitest";
import { createProvider } from "@/lib/deploy/registry";
import { safeRedirect } from "@/lib/deploy/oauth";
import type { DeployTarget } from "@/lib/deploy/types";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const TARGET: DeployTarget = {
  projectName: "northwind",
  environment: "production",
  accountId: "team_123",
};

describe("Vercel domains", () => {
  /** A user pastes this into their registrar, so it must survive verbatim. */
  it("surfaces the host's verification record exactly", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        name: "northwind.com",
        verified: false,
        verification: [{ type: "TXT", domain: "_vercel.northwind.com", value: "vc-domain-verify=abc123" }],
      }),
    );
    const provider = createProvider("vercel", "tok", fetchImpl as never);

    const state = await provider.addDomain!("northwind.com", TARGET);

    expect(state.status).toBe("pending");
    expect(state.verification).toEqual({
      type: "TXT",
      name: "_vercel.northwind.com",
      value: "vc-domain-verify=abc123",
    });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/projects/northwind/domains");
    expect(url).toContain("teamId=team_123");
    expect(JSON.parse(init.body as string)).toEqual({ name: "northwind.com" });
  });

  it("reports a verified domain as verified with no challenge", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ name: "northwind.com", verified: true }));
    const provider = createProvider("vercel", "tok", fetchImpl as never);

    const state = await provider.checkDomain!("northwind.com", TARGET);
    expect(state).toEqual({ status: "verified" });
  });

  /** No challenge yet means the host is still working it out. Calling that
   *  "failed" sends the user chasing a problem that does not exist. */
  it("treats a missing challenge as still verifying, not failed", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ name: "northwind.com", verified: false }));
    const provider = createProvider("vercel", "tok", fetchImpl as never);

    expect((await provider.checkDomain!("northwind.com", TARGET)).status).toBe("verifying");
  });

  it("deletes on removal", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}));
    const provider = createProvider("vercel", "tok", fetchImpl as never);

    await provider.removeDomain!("northwind.com", TARGET);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe("DELETE");
    expect(url).toContain("/domains/northwind.com");
  });
});

describe("Netlify domains", () => {
  it("adds to the alias list without dropping existing aliases", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "PATCH"
        ? jsonResponse({})
        : jsonResponse({ name: "northwind", domain_aliases: ["www.northwind.com"], ssl_url: "https://x" }),
    );
    const provider = createProvider("netlify", "tok", fetchImpl as never);

    const state = await provider.addDomain!("northwind.com", { ...TARGET, accountId: "site_1" });

    const patch = fetchImpl.mock.calls.find(([, init]) => (init as RequestInit)?.method === "PATCH");
    const body = JSON.parse((patch![1] as RequestInit).body as string);

    expect(body.domain_aliases).toContain("www.northwind.com");
    expect(body.domain_aliases).toContain("northwind.com");
    expect(state.verification).toMatchObject({ type: "CNAME", value: "northwind.netlify.app" });
  });

  /** SSL only provisions once DNS resolves, so it is the real signal. */
  it("only reports verified once SSL covers the domain", async () => {
    const pending = vi.fn(async () =>
      jsonResponse({ domain_aliases: ["northwind.com"], ssl_url: "https://northwind.netlify.app" }),
    );
    expect(
      (await createProvider("netlify", "tok", pending as never).checkDomain!("northwind.com", TARGET)).status,
    ).toBe("verifying");

    const done = vi.fn(async () =>
      jsonResponse({ domain_aliases: ["northwind.com"], ssl_url: "https://northwind.com" }),
    );
    expect(
      (await createProvider("netlify", "tok", done as never).checkDomain!("northwind.com", TARGET)).status,
    ).toBe("verified");
  });

  it("fails when the domain was detached behind our back", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ domain_aliases: [] }));
    const provider = createProvider("netlify", "tok", fetchImpl as never);

    const state = await provider.checkDomain!("northwind.com", TARGET);
    expect(state.status).toBe("failed");
  });
});

describe("Cloudflare domains", () => {
  it("attaches and returns the pages CNAME target", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ success: true, result: { name: "northwind.com" } }));
    const provider = createProvider("cloudflare", "tok", fetchImpl as never);

    const state = await provider.addDomain!("northwind.com", TARGET);
    expect(state.verification).toEqual({
      type: "CNAME",
      name: "northwind.com",
      value: "northwind.pages.dev",
    });
  });

  it("maps Cloudflare domain statuses", async () => {
    const cases: [string, string][] = [
      ["active", "verified"],
      ["pending", "verifying"],
      ["blocked", "failed"],
    ];

    for (const [status, expected] of cases) {
      const fetchImpl = vi.fn(async () =>
        jsonResponse({ success: true, result: [{ name: "northwind.com", status }] }),
      );
      const provider = createProvider("cloudflare", "tok", fetchImpl as never);
      expect((await provider.checkDomain!("northwind.com", TARGET)).status).toBe(expected);
    }
  });

  it("still honours the success envelope on domain calls", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ success: false, result: null, errors: [{ code: 1234, message: "Zone not found" }] }),
    );
    const provider = createProvider("cloudflare", "tok", fetchImpl as never);

    await expect(provider.addDomain!("northwind.com", TARGET)).rejects.toMatchObject({ name: "DeploymentError" });
  });
});

describe("safeRedirect", () => {
  it("allows same-origin relative paths", () => {
    expect(safeRedirect("/dashboard/deployments")).toBe("/dashboard/deployments");
  });

  /** A callback that can bounce off-site is an open redirect. */
  it("refuses protocol-relative and absolute URLs", () => {
    expect(safeRedirect("//evil.test")).toBe("/dashboard/deployments");
    expect(safeRedirect("https://evil.test")).toBe("/dashboard/deployments");
    expect(safeRedirect("")).toBe("/dashboard/deployments");
  });
});
