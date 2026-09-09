import { describe, expect, it, vi } from "vitest";
import { FigmaApiError, FigmaClient, FIGMA_ERROR_COPY } from "@/lib/figma/client";
import { FILE } from "./fixtures/figma-file";

function response(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

describe("FigmaClient", () => {
  it("sends a bearer header for OAuth tokens", async () => {
    const fetchImpl = vi.fn(async () => response(FILE));
    const client = new FigmaClient({ accessToken: "tok", tokenKind: "oauth", fetchImpl: fetchImpl as never });

    await client.getFile("abc");

    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });

  it("sends the token header for personal access tokens", async () => {
    const fetchImpl = vi.fn(async () => response(FILE));
    const client = new FigmaClient({ accessToken: "tok", tokenKind: "personal", fetchImpl: fetchImpl as never });

    await client.getFile("abc");

    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)["X-Figma-Token"]).toBe("tok");
  });

  it("passes the node id and depth through to the API", async () => {
    const fetchImpl = vi.fn(async () => response(FILE));
    const client = new FigmaClient({ accessToken: "tok", fetchImpl: fetchImpl as never });

    await client.getFile("abc", { nodeId: "142:8", depth: 12 });

    const [url] = fetchImpl.mock.calls[0] as unknown as [string];
    expect(url).toContain("ids=142%3A8");
    expect(url).toContain("depth=12");
  });

  it("classifies a 403 as a sharing problem, not a crash", async () => {
    const fetchImpl = vi.fn(async () => response({ err: "nope" }, { status: 403 }));
    const client = new FigmaClient({ accessToken: "tok", fetchImpl: fetchImpl as never });

    await expect(client.getFile("abc")).rejects.toMatchObject({
      code: "forbidden",
      message: FIGMA_ERROR_COPY.forbidden,
    });
  });

  it("classifies 401 and 404 distinctly", async () => {
    for (const [status, code] of [[401, "unauthorised"], [404, "not_found"]] as const) {
      const fetchImpl = vi.fn(async () => response({}, { status }));
      const client = new FigmaClient({ accessToken: "tok", fetchImpl: fetchImpl as never });
      await expect(client.getFile("abc")).rejects.toMatchObject({ code });
    }
  });

  it("does not retry a client error", async () => {
    const fetchImpl = vi.fn(async () => response({}, { status: 404 }));
    const client = new FigmaClient({ accessToken: "tok", fetchImpl: fetchImpl as never });

    await expect(client.getFile("abc")).rejects.toBeInstanceOf(FigmaApiError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries a rate limit and honours Retry-After", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      return calls === 1 ? response({}, { status: 429, headers: { "Retry-After": "1" } }) : response(FILE);
    });
    const client = new FigmaClient({ accessToken: "tok", fetchImpl: fetchImpl as never });

    const pending = client.getFile("abc");
    await vi.advanceTimersByTimeAsync(1100);
    await expect(pending).resolves.toMatchObject({ name: "Northwind" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("gives up after three retries on a persistent 500", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(async () => response({}, { status: 500 }));
    const client = new FigmaClient({ accessToken: "tok", fetchImpl: fetchImpl as never });

    const pending = client.getFile("abc").catch((error) => error);
    await vi.advanceTimersByTimeAsync(60_000);
    const result = await pending;

    expect(result).toBeInstanceOf(FigmaApiError);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    vi.useRealTimers();
  });

  // Figma's own error text leaks internals and changes without notice.
  it("never surfaces upstream error text to the user", async () => {
    const fetchImpl = vi.fn(async () =>
      response({ err: "internal shard 42 unavailable" }, { status: 500 }),
    );
    const client = new FigmaClient({ accessToken: "tok", fetchImpl: fetchImpl as never });
    vi.useFakeTimers();
    const pending = client.getFile("abc").catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(60_000);
    const error = await pending;
    expect(error).toBeInstanceOf(FigmaApiError);
    const figmaError = error as FigmaApiError;
    expect(figmaError.message).toBe(FIGMA_ERROR_COPY.upstream);
    expect(figmaError.message).not.toContain("shard");
    vi.useRealTimers();
  });
});
