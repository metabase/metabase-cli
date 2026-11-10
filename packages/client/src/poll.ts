import { setTimeout as delay } from "node:timers/promises";

import { ConfigError, TimeoutError } from "./errors";

import { combineAborts, throwIfAborted } from "./signal";

export type Backoff = "fixed" | "exponential";

export interface PollOptions {
  intervalMs?: number;
  maxIntervalMs?: number;
  // How long the whole wait may run, `DEFAULT_TIMEOUT_MS` when left out; `null` waits for as long
  // as it takes, until a signal ends it.
  timeoutMs?: number | null;
  backoff?: Backoff;
  signal?: AbortSignal;
}

// A wait run under a deadline started before it, which sets how long it may run.
export type PollSchedule = Omit<PollOptions, "timeoutMs">;

export const DEFAULT_INTERVAL_MS = 2_000;
export const DEFAULT_MAX_INTERVAL_MS = 30_000;
export const DEFAULT_TIMEOUT_MS = 600_000;
// The longest delay a timer keeps: Node fires a longer one after 1 ms.
export const MAX_TIMER_MS = 2_147_483_647;

// When a wait gives up, fixed as it starts, so the waits of one run share it.
export interface Deadline {
  timeoutMs: number;
  signal: AbortSignal;
}

// The deadline `timeoutMs` sets from now, or `null` for a wait without one.
export function startDeadline(timeoutMs: number | null | undefined): Deadline | null {
  if (timeoutMs === null) {
    return null;
  }
  const ms = timerDelay(timeoutMs ?? DEFAULT_TIMEOUT_MS, "timeout");
  return { timeoutMs: ms, signal: AbortSignal.timeout(ms) };
}

export async function pollUntil<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  done: (value: T) => boolean,
  opts: PollOptions = {},
): Promise<T> {
  return pollWithin(startDeadline(opts.timeoutMs), fn, done, opts);
}

// `pollUntil` under a deadline started before it, so the waits of one run share it.
export async function pollWithin<T>(
  deadline: Deadline | null,
  fn: (signal: AbortSignal) => Promise<T>,
  done: (value: T) => boolean,
  opts: PollSchedule = {},
): Promise<T> {
  const intervalMs = timerDelay(opts.intervalMs ?? DEFAULT_INTERVAL_MS, "interval");
  const maxIntervalMs = timerDelay(
    opts.maxIntervalMs ?? DEFAULT_MAX_INTERVAL_MS,
    "maximum interval",
  );
  const backoff = opts.backoff ?? "fixed";

  const combined = combineAborts(deadline?.signal, opts.signal);
  const throwIfStopped = (attempts: number): void => {
    throwIfAborted(opts.signal);
    if (deadline !== null && deadline.signal.aborted) {
      throw pollTimeout(deadline.timeoutMs, attempts);
    }
  };

  let interval = intervalMs;
  let attempts = 0;

  while (true) {
    throwIfStopped(attempts);

    let value: T;
    try {
      value = await fn(combined);
    } catch (error) {
      throwIfStopped(attempts);
      throw error;
    }
    attempts += 1;
    if (done(value)) {
      return value;
    }

    try {
      await delay(interval, undefined, { signal: combined });
    } catch (error) {
      throwIfStopped(attempts);
      throw error;
    }

    if (backoff === "exponential") {
      interval = Math.min(interval * 2, maxIntervalMs);
    }
  }
}

function timerDelay(ms: number, name: string): number {
  if (ms > MAX_TIMER_MS) {
    throw new ConfigError(
      `A wait's ${name} of ${ms}ms is longer than a timer can run, ${MAX_TIMER_MS}ms`,
    );
  }
  return ms;
}

function pollTimeout(timeoutMs: number, attempts: number): TimeoutError {
  return new TimeoutError(`Polling timed out after ${timeoutMs}ms`, {
    kind: "polling",
    timeoutMs,
    attempts,
  });
}
