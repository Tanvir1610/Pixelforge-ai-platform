import { describe, expect, it, vi } from "vitest";
import { createProvider } from "@/lib/deploy/registry";
import { sha1 } from "@/lib/deploy/providers/netlify";
import { DeploymentError, type DeploymentFile, type DeployTarget } from "@/lib/deploy/types";

/**
 * The deploy APIs are unreachable from this environment, but `fetch` is
 * injectable — so request shape, auth headers, status mapping and error
 * classification are all verifiable. Getting a header wrong against a real
 * deploy API creates or destroys infrastructure on a customer's account, which
 * is exactly why this is tested rather than assumed.
 */
function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

const FILES: DeploymentFile[] = [
  { path: "index.html", content: "<h1>hi</h1>" },
  { path: "assets/app.css", content: "body{}" },
];

const TARGET: DeployTarget = {
  projectName: "northwind",
  environment: "production",
  accountId: "team_123",
  buildCommand: "npm run build",
  outputDirectory: ".next",
  environmentVariables: { NEXT_PUBLIC_SITE_URL: "https://northwind.com" },
};

describe("Vercel", () => {
  it("posts files inline and targets production explicitly", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ id: "dpl_1", url: "northwind.vercel.app" }));
    const provider = createProvider("vercel", "tok", fetchImpl as never);

    const handle = await provider.deploy(FILES, TARGET);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("api.vercel.com/v13/deployments");
    expect(url).toContain("teamId=team_123");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");

    const body = JSON.parse(init.body as string);
    expect(body.target).toBe("production");
    expect(body.files).toHaveLength(2);
    expect(body.files[0]).toMatchObject({ file: "index.html", encoding: "utf-8" });
    expect(handle.providerDeploymentId).toBe("dpl_1");
    expect(handle.url).toBe("https://northwind.vercel.app");
  });

  /** Secrets in the file set would be committed to version history and handed
   *  to anyone exporting the project. */
  it("sends environment variables in the request, not as files", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ id: "dpl_1" }));
    const provider = createProvider("vercel", "tok", fetchImpl as never);

    await provider.deploy(FILES, TARGET);

    const body = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.env.NEXT_PUBLIC_SITE_URL).toBe("https://northwind.com");
    expect(body.files.some((file: { file: string }) => file.file.includes(".env"))).toBe(false);
  });

  it("omits the target for a preview deployment", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ id: "dpl_1" }));
    const provider = createProvider("vercel", "tok", fetchImpl as never);

    await provider.deploy(FILES, { ...TARGET, environment: "preview" });

    const body = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.target).toBeUndefined();
  });

  it("maps readyState onto our phases", async () => {
    const cases: [string, string, string][] = [
      ["QUEUED", "queued", "queued"],
      ["BUILDING", "building", "running"],
      ["READY", "live", "completed"],
      ["ERROR", "failed", "failed"],
      ["CANCELED", "cancelled", "cancelled"],
    ];

    for (const [readyState, phase, status] of cases) {
      const fetchImpl = vi.fn(async () => jsonResponse({ id: "dpl_1", readyState }));
      const provider = createProvider("vercel", "tok", fetchImpl as never);
      const state = await provider.getState({ providerDeploymentId: "dpl_1" }, TARGET);
      expect(state).toMatchObject({ phase, status });
    }
  });

  /** The alias is the stable production URL; the deployment URL is per-build. */
  it("prefers the alias over the per-build URL", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ id: "dpl_1", readyState: "READY", url: "abc-123.vercel.app", alias: ["northwind.com"] }),
    );
    const provider = createProvider("vercel", "tok", fetchImpl as never);

    const state = await provider.getState({ providerDeploymentId: "dpl_1" }, TARGET);
    expect(state.url).toBe("https://northwind.com");
  });

  it("treats an unknown state as still running rather than done", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ id: "dpl_1", readyState: "SOMETHING_NEW" }));
    const provider = createProvider("vercel", "tok", fetchImpl as never);
    const state = await provider.getState({ providerDeploymentId: "dpl_1" }, TARGET);
    expect(state.status).toBe("running");
  });
});

describe("Netlify", () => {
  it("posts a digest first and uploads only the missing files", async () => {
    const requiredHash = sha1("<h1>hi</h1>");
    const fetchImpl = vi.fn(async (url: string) =>
      url.includes("/deploys/") && url.includes("/files/")
        ? jsonResponse({})
        : jsonResponse({ id: "dep_1", required: [requiredHash], ssl_url: "https://northwind.netlify.app" }),
    );

    const provider = createProvider("netlify", "tok", fetchImpl as never);
    const handle = await provider.deploy(FILES, { ...TARGET, accountId: "site_1" });

    expect(handle.providerDeploymentId).toBe("dep_1");

    const digestBody = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(digestBody.files["/index.html"]).toBe(requiredHash);
    expect(digestBody.draft).toBe(false);

    // Two files were offered; only the one Netlify asked for is uploaded.
    const uploads = fetchImpl.mock.calls.filter(([url]) => String(url).includes("/files/"));
    expect(uploads).toHaveLength(1);
    expect(String(uploads[0][0])).toContain("/files/index.html");
  });

  it("marks a preview deployment as a draft", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ id: "dep_1", required: [] }));
    const provider = createProvider("netlify", "tok", fetchImpl as never);

    await provider.deploy(FILES, { ...TARGET, environment: "preview", accountId: "site_1" });

    const body = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.draft).toBe(true);
  });

  it("maps Netlify states and surfaces its error message", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ id: "dep_1", state: "error", error_message: "Build exceeded memory" }),
    );
    const provider = createProvider("netlify", "tok", fetchImpl as never);

    const state = await provider.getState({ providerDeploymentId: "dep_1" }, TARGET);
    expect(state).toMatchObject({ phase: "failed", status: "failed" });
    expect(state.errorMessage).toContain("memory");
  });

  it("reports ready as live", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ id: "dep_1", state: "ready", ssl_url: "https://x.netlify.app" }));
    const provider = createProvider("netlify", "tok", fetchImpl as never);

    const state = await provider.getState({ providerDeploymentId: "dep_1" }, TARGET);
    expect(state).toMatchObject({ phase: "live", status: "completed", url: "https://x.netlify.app" });
  });
});

describe("Cloudflare", () => {
  it("uploads multipart without overriding the boundary", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ success: true, result: { id: "cf_1", url: "https://northwind.pages.dev" } }),
    );
    const provider = createProvider("cloudflare", "tok", fetchImpl as never);

    const handle = await provider.deploy(FILES, TARGET);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/accounts/team_123/pages/projects/northwind/deployments");
    expect(init.body).toBeInstanceOf(FormData);
    // Setting Content-Type manually would break the multipart boundary.
    expect((init.headers as Record<string, string>)["Content-Type"]).toBeUndefined();
    expect(handle.providerDeploymentId).toBe("cf_1");
  });

  /** A 200 with success:false is still a failure — easy to miss, and it
   *  produces a deployment that silently never appears. */
  it("treats success:false as a failure despite the 200", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ success: false, result: null, errors: [{ code: 8000007, message: "Project not found" }] }),
    );
    const provider = createProvider("cloudflare", "tok", fetchImpl as never);

    await expect(provider.getState({ providerDeploymentId: "cf_1" }, TARGET)).rejects.toBeInstanceOf(DeploymentError);
  });

  it("only reports live when the deploy stage itself succeeded", async () => {
    const building = vi.fn(async () =>
      jsonResponse({ success: true, result: { id: "cf_1", latest_stage: { name: "build", status: "success" } } }),
    );
    expect(
      (await createProvider("cloudflare", "tok", building as never).getState({ providerDeploymentId: "cf_1" }, TARGET))
        .status,
    ).toBe("running");

    const done = vi.fn(async () =>
      jsonResponse({ success: true, result: { id: "cf_1", latest_stage: { name: "deploy", status: "success" } } }),
    );
    expect(
      (await createProvider("cloudflare", "tok", done as never).getState({ providerDeploymentId: "cf_1" }, TARGET))
        .status,
    ).toBe("completed");
  });

  it("maps a stage failure to failed", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ success: true, result: { id: "cf_1", latest_stage: { name: "build", status: "failure" } } }),
    );
    const provider = createProvider("cloudflare", "tok", fetchImpl as never);
    expect((await provider.getState({ providerDeploymentId: "cf_1" }, TARGET)).status).toBe("failed");
  });
});

describe("error classification", () => {
  it("maps HTTP status onto actionable codes", async () => {
    const cases: [number, string][] = [
      [401, "unauthorised"],
      [403, "forbidden"],
      [404, "not_found"],
      [402, "quota_exceeded"],
      [422, "invalid_config"],
    ];

    for (const [status, code] of cases) {
      const fetchImpl = vi.fn(async () => jsonResponse({ error: "nope" }, status));
      const provider = createProvider("vercel", "tok", fetchImpl as never);
      await expect(provider.deploy(FILES, TARGET)).rejects.toMatchObject({ code });
    }
  });

  /** Retrying a POST on a deploy API risks creating two deployments. */
  it("never retries a failed deploy request", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 500));
    const provider = createProvider("vercel", "tok", fetchImpl as never);

    await expect(provider.deploy(FILES, TARGET)).rejects.toBeInstanceOf(DeploymentError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries a status poll on a server error", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      return calls === 1 ? jsonResponse({}, 503) : jsonResponse({ id: "dpl_1", readyState: "READY" });
    });
    const provider = createProvider("vercel", "tok", fetchImpl as never);

    const state = await provider.getState({ providerDeploymentId: "dpl_1" }, TARGET);
    expect(state.status).toBe("completed");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  }, 15_000);
});
