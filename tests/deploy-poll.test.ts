import { describe, expect, it, vi } from "vitest";
import { pollUntilSettled } from "@/lib/deploy/poll";
import type { DeploymentProvider, DeploymentState, DeployTarget } from "@/lib/deploy/types";

const TARGET: DeployTarget = { projectName: "northwind", environment: "production" };
const HANDLE = { providerDeploymentId: "dpl_1" };

/** A provider that walks a scripted sequence of states. */
function scripted(states: DeploymentState[]): DeploymentProvider {
  let index = 0;
  return {
    key: "vercel",
    displayName: "Scripted",
    async deploy() {
      return HANDLE;
    },
    async getState() {
      const state = states[Math.min(index, states.length - 1)];
      index += 1;
      return state;
    },
  } as DeploymentProvider;
}

const running: DeploymentState = { phase: "building", status: "running" };

/** Time is injected so the suite never actually waits. */
function fakeClock() {
  let now = 0;
  return {
    now: () => now,
    sleep: async (ms: number) => {
      now += ms;
    },
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("pollUntilSettled", () => {
  it("returns as soon as a terminal state is reached", async () => {
    const clock = fakeClock();
    const provider = scripted([running, running, { phase: "live", status: "completed", url: "https://x.dev" }]);

    const result = await pollUntilSettled(provider, HANDLE, TARGET, { sleep: clock.sleep, now: clock.now });

    expect(result.state.status).toBe("completed");
    expect(result.state.url).toBe("https://x.dev");
    expect(result.polls).toBe(3);
    expect(result.timedOut).toBe(false);
  });

  it("stops on failure without waiting out the timeout", async () => {
    const clock = fakeClock();
    const provider = scripted([{ phase: "failed", status: "failed", errorMessage: "build error" }]);

    const result = await pollUntilSettled(provider, HANDLE, TARGET, { sleep: clock.sleep, now: clock.now });

    expect(result.state.status).toBe("failed");
    expect(result.polls).toBe(1);
  });

  it("reports every observed state so the UI can track progress", async () => {
    const clock = fakeClock();
    const observed: string[] = [];
    const provider = scripted([
      { phase: "queued", status: "queued" },
      { phase: "building", status: "running" },
      { phase: "deploying", status: "running" },
      { phase: "live", status: "completed" },
    ]);

    await pollUntilSettled(provider, HANDLE, TARGET, {
      sleep: clock.sleep,
      now: clock.now,
      onState: (state) => {
        observed.push(state.phase);
      },
    });

    expect(observed).toEqual(["queued", "building", "deploying", "live"]);
  });

  /** A build that has not finished by the budget will not finish. */
  it("gives up at the timeout and says so", async () => {
    const clock = fakeClock();
    const provider = scripted([running]);

    const result = await pollUntilSettled(provider, HANDLE, TARGET, {
      timeoutMs: 30_000,
      sleep: clock.sleep,
      now: clock.now,
    });

    expect(result.timedOut).toBe(true);
    expect(result.state.status).toBe("failed");
    expect(result.state.errorMessage).toContain("did not finish");
  });

  /** Fast early so it feels responsive; capped so a five-minute build does not
   *  hammer the host. */
  it("backs off exponentially up to the ceiling", async () => {
    const delays: number[] = [];
    const provider = scripted([running]);
    let now = 0;

    await pollUntilSettled(provider, HANDLE, TARGET, {
      timeoutMs: 40_000,
      initialDelayMs: 1_000,
      maxDelayMs: 5_000,
      now: () => now,
      sleep: async (ms) => {
        delays.push(ms);
        now += ms;
      },
    });

    expect(delays[0]).toBe(1_000);
    expect(delays[1]).toBeGreaterThan(delays[0]);
    expect(Math.max(...delays)).toBeLessThanOrEqual(5_000);
  });

  it("honours an abort signal", async () => {
    const clock = fakeClock();
    const controller = new AbortController();
    controller.abort();

    const result = await pollUntilSettled(scripted([running]), HANDLE, TARGET, {
      signal: controller.signal,
      sleep: clock.sleep,
      now: clock.now,
    });

    expect(result.state.status).toBe("cancelled");
    expect(result.polls).toBe(0);
  });

  it("propagates a provider error rather than reporting success", async () => {
    const provider: DeploymentProvider = {
      key: "vercel",
      displayName: "Broken",
      async deploy() {
        return HANDLE;
      },
      async getState(): Promise<DeploymentState> {
        throw new Error("network down");
      },
    };

    await expect(
      pollUntilSettled(provider, HANDLE, TARGET, { sleep: vi.fn(), now: () => 0 }),
    ).rejects.toThrow("network down");
  });
});
