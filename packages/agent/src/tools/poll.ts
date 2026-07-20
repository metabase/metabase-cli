import { setTimeout as sleep } from "node:timers/promises";
import { Type } from "typebox";
import { TeachingError } from "./teaching-error";

const DEFAULT_TIMEOUT_MS = 300_000;
const MIN_TIMEOUT_MS = 1_000;
const FIRST_INTERVAL_MS = 500;
const MAX_INTERVAL_MS = 5_000;
const BACKOFF_FACTOR = 1.5;
const MS_PER_SECOND = 1000;

export const waitParam = Type.Optional(
  Type.Boolean({
    description:
      "Block until the work reaches a terminal state and return that state (default `true`). `false` returns as soon as the work is queued — the outcome is then unknown, and nothing else re-checks it for you.",
  }),
);

export const timeoutMsParam = Type.Optional(
  Type.Integer({
    description: `How long to block while waiting, in milliseconds (default ${String(DEFAULT_TIMEOUT_MS)}). On expiry the work keeps running server-side and the tool returns a teaching error naming the call that re-checks it.`,
  }),
);

export function resolveWait(wait: boolean | undefined): boolean {
  return wait ?? true;
}

export function resolveTimeoutMs(timeoutMs: number | undefined): number {
  if (timeoutMs === undefined) {
    return DEFAULT_TIMEOUT_MS;
  }
  return Math.max(MIN_TIMEOUT_MS, timeoutMs);
}

export interface PollOptions {
  timeoutMs: number;
  /** What is being waited on, e.g. "Run 12 of transform 3". */
  subject: string;
  /** The literal call that re-checks it once the wait gives up. */
  recheck: string;
}

/**
 * Polls until `isDone`, then returns the value it saw. A timeout is not a failure of the work — the
 * server keeps going — so the error says so and names the call that picks the thread back up.
 */
export async function pollUntil<T>(
  fetch: () => Promise<T>,
  isDone: (value: T) => boolean,
  options: PollOptions,
): Promise<T> {
  const deadline = Date.now() + options.timeoutMs;
  let interval = FIRST_INTERVAL_MS;
  for (;;) {
    const value = await fetch();
    if (isDone(value)) {
      return value;
    }
    if (Date.now() + interval >= deadline) {
      const seconds = Math.round(options.timeoutMs / MS_PER_SECOND);
      throw new TeachingError(
        `${options.subject} is still running after ${String(seconds)}s. It has not failed — it is still going server-side. Check on it with \`${options.recheck}\`, or raise \`timeout_ms\`.`,
      );
    }
    await sleep(interval);
    interval = Math.min(MAX_INTERVAL_MS, Math.round(interval * BACKOFF_FACTOR));
  }
}
