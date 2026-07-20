import { setTimeout as delay } from "node:timers/promises";

export const DEFAULT_MAX_RETRIES = 3;
const BASE_DELAY_MS = 250;
const MAX_DELAY_MS = 8_000;
const MS_PER_SECOND = 1_000;

export interface BackoffInput {
  attempt: number;
  retryAfterHeader?: string | null;
}

export function backoffDelay({ attempt, retryAfterHeader }: BackoffInput): number {
  const fromHeader = parseRetryAfter(retryAfterHeader);
  if (fromHeader !== null) {
    return fromHeader;
  }
  return Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** attempt);
}

function parseRetryAfter(header: string | null | undefined): number | null {
  if (!header) {
    return null;
  }
  const numeric = Number(header);
  if (Number.isFinite(numeric) && numeric >= 0) {
    return Math.round(numeric * MS_PER_SECOND);
  }
  const dateMs = Date.parse(header);
  if (Number.isFinite(dateMs)) {
    return Math.max(0, dateMs - Date.now());
  }
  return null;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return delay(ms, undefined, { signal });
}

interface RetrySuccess {
  kind: "success";
  response: Response;
}

interface RetryBackoff {
  kind: "retry";
  delayMs: number;
}

export type RetryOutcome = RetrySuccess | RetryBackoff;

// `attempt` owns the terminal decision: return `success`, return `retry` to back off and run
// again, or throw to fail hard. This helper only sequences the backoff sleep between retries —
// without a throwing terminal case it would loop forever.
export async function runWithRetries(
  attempt: (attemptIndex: number) => Promise<RetryOutcome>,
  signal?: AbortSignal,
): Promise<Response> {
  let attemptIndex = 0;
  while (true) {
    const outcome = await attempt(attemptIndex);
    if (outcome.kind === "success") {
      return outcome.response;
    }
    await sleep(outcome.delayMs, signal);
    attemptIndex += 1;
  }
}
