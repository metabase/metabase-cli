import { setTimeout as delay } from "node:timers/promises";

import { TimeoutError } from "../core/errors";

import { combineAborts, throwIfAborted } from "./signal";

export type Backoff = "fixed" | "exponential";

export interface PollOptions {
  intervalMs?: number;
  maxIntervalMs?: number;
  timeoutMs?: number;
  backoff?: Backoff;
  signal?: AbortSignal;
}

const DEFAULT_INTERVAL_MS = 2_000;
const DEFAULT_MAX_INTERVAL_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 600_000;

export async function pollUntil<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  done: (value: T) => boolean,
  opts: PollOptions = {},
): Promise<T> {
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
  const maxIntervalMs = opts.maxIntervalMs ?? DEFAULT_MAX_INTERVAL_MS;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const backoff = opts.backoff ?? "fixed";

  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const { combined, processSignal } = combineAborts(timeoutSignal, opts.signal);

  let interval = intervalMs;
  let attempts = 0;

  while (true) {
    throwIfAborted(processSignal);
    if (combined.aborted) {
      throw pollTimeout(timeoutMs, attempts);
    }

    let value: T;
    try {
      value = await fn(combined);
    } catch (error) {
      throwIfAborted(processSignal);
      if (combined.aborted) {
        throw pollTimeout(timeoutMs, attempts);
      }
      throw error;
    }
    attempts += 1;
    if (done(value)) {
      return value;
    }

    try {
      await delay(interval, undefined, { signal: combined });
    } catch (error) {
      throwIfAborted(processSignal);
      if (combined.aborted) {
        throw pollTimeout(timeoutMs, attempts);
      }
      throw error;
    }

    if (backoff === "exponential") {
      interval = Math.min(interval * 2, maxIntervalMs);
    }
  }
}

function pollTimeout(timeoutMs: number, attempts: number): TimeoutError {
  return new TimeoutError(`Polling timed out after ${timeoutMs}ms`, {
    kind: "polling",
    timeoutMs,
    attempts,
  });
}
