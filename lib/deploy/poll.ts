import type { DeploymentHandle, DeploymentProvider, DeploymentState, DeployTarget } from "./types";

/**
 * Polling.
 *
 * The loop lives here rather than in each provider so backoff, timeout and
 * terminal-state policy are decided once. Hosts differ in how long a build
 * takes; none of them differ in how we should wait.
 */
export interface PollOptions {
  /** Total budget. A build that has not finished by now will not finish. */
  timeoutMs?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  onState?: (state: DeploymentState) => void | Promise<void>;
  signal?: AbortSignal;
  /** Injected in tests so the suite does not actually wait. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface PollResult {
  state: DeploymentState;
  polls: number;
  timedOut: boolean;
}

const TERMINAL = new Set(["completed", "failed", "cancelled"]);

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function pollUntilSettled(
  provider: DeploymentProvider,
  handle: DeploymentHandle,
  target: DeployTarget,
  options: PollOptions = {},
): Promise<PollResult> {
  const timeoutMs = options.timeoutMs ?? 10 * 60_000;
  const maxDelayMs = options.maxDelayMs ?? 8_000;
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;

  const started = now();
  let delay = options.initialDelayMs ?? 1_000;
  let polls = 0;
  let last: DeploymentState = { phase: "queued", status: "queued", url: handle.url };

  while (now() - started < timeoutMs) {
    if (options.signal?.aborted) {
      return { state: { ...last, phase: "cancelled", status: "cancelled" }, polls, timedOut: false };
    }

    last = await provider.getState(handle, target);
    polls += 1;
    await options.onState?.(last);

    if (TERMINAL.has(last.status)) {
      return { state: last, polls, timedOut: false };
    }

    await sleep(delay);
    // Exponential up to a ceiling: fast enough to feel responsive early,
    // cheap enough not to hammer the host through a five-minute build.
    delay = Math.min(delay * 1.6, maxDelayMs);
  }

  return {
    state: {
      ...last,
      phase: "failed",
      status: "failed",
      errorMessage: `The host did not finish within ${Math.round(timeoutMs / 60_000)} minutes.`,
    },
    polls,
    timedOut: true,
  };
}
