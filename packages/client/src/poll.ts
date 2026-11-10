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

const SCHEDULE_DELAYS = ["timeoutMs", "intervalMs", "maxIntervalMs"] as const;
type ScheduleDelay = (typeof SCHEDULE_DELAYS)[number];

// Refuses a schedule no timer can keep, naming the field, so a call that starts work and then
// waits on it refuses before it starts anything. `undefined` is a call that runs no wait.
export function checkSchedule(schedule: PollOptions | undefined): void {
  if (schedule === undefined) {
    return;
  }
  for (const field of SCHEDULE_DELAYS) {
    checkDelay(field, schedule[field]);
  }
}

// The deadline the schedule's `timeoutMs` sets from now, or `null` for a wait without one. The
// whole schedule is checked first, so no wait run under the deadline fails on it later.
export function startDeadline(schedule: PollOptions): Deadline | null {
  checkSchedule(schedule);
  if (schedule.timeoutMs === null) {
    return null;
  }
  const timeoutMs = schedule.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return { timeoutMs, signal: AbortSignal.timeout(timeoutMs) };
}

export async function pollUntil<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  done: (value: T) => boolean,
  opts: PollOptions = {},
): Promise<T> {
  return pollWithin(startDeadline(opts), fn, done, opts);
}

// `pollUntil` under a deadline started before it, so the waits of one run share it.
export async function pollWithin<T>(
  deadline: Deadline | null,
  fn: (signal: AbortSignal) => Promise<T>,
  done: (value: T) => boolean,
  opts: PollSchedule = {},
): Promise<T> {
  checkSchedule(opts);
  const maxIntervalMs = opts.maxIntervalMs ?? DEFAULT_MAX_INTERVAL_MS;
  const backoff = opts.backoff ?? "fixed";

  const combined = combineAborts(deadline?.signal, opts.signal);
  const throwIfStopped = (attempts: number): void => {
    throwIfAborted(opts.signal);
    if (deadline !== null && deadline.signal.aborted) {
      throw pollTimeout(deadline.timeoutMs, attempts);
    }
  };

  let interval = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
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

function checkDelay(field: ScheduleDelay, ms: number | null | undefined): void {
  if (ms === null || ms === undefined) {
    return;
  }
  if (!Number.isFinite(ms) || ms < 0) {
    throw new ConfigError(
      `A wait's ${field} of ${ms} is not a non-negative number of milliseconds`,
    );
  }
  if (ms > MAX_TIMER_MS) {
    throw new ConfigError(
      `A wait's ${field} of ${ms}ms is longer than a timer can run, ${MAX_TIMER_MS}ms`,
    );
  }
}

function pollTimeout(timeoutMs: number, attempts: number): TimeoutError {
  return new TimeoutError(`Polling timed out after ${timeoutMs}ms`, {
    kind: "polling",
    timeoutMs,
    attempts,
  });
}
