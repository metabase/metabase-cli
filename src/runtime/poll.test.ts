import { describe, expect, it } from "vitest";

import { TimeoutError } from "../core/errors";
import { pollUntil } from "./poll";

describe("pollUntil", () => {
  it("returns the value once done is satisfied", async () => {
    let calls = 0;
    const result = await pollUntil(
      async () => {
        calls += 1;
        return calls;
      },
      (value) => value === 3,
      { intervalMs: 1, timeoutMs: 1_000 },
    );
    expect(result).toBe(3);
    expect(calls).toBe(3);
  });

  it("throws TimeoutError with polling detail when budget elapses", async () => {
    const error = await pollUntil(
      async () => "still working",
      () => false,
      { intervalMs: 100, timeoutMs: 10 },
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(TimeoutError);
    if (!(error instanceof TimeoutError)) {
      throw new Error("expected TimeoutError");
    }
    expect(error.userMessage).toBe("Polling timed out after 10ms");
    expect(error.developerDetail).toEqual({ kind: "polling", timeoutMs: 10, attempts: 1 });
  });

  it("throws TimeoutError when the external signal aborts before any call", async () => {
    const controller = new AbortController();
    controller.abort();
    const error = await pollUntil(
      async () => "never",
      () => false,
      { intervalMs: 1_000, timeoutMs: 60_000, signal: controller.signal },
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(TimeoutError);
    if (!(error instanceof TimeoutError)) {
      throw new Error("expected TimeoutError");
    }
    expect(error.developerDetail).toEqual({ kind: "polling", timeoutMs: 60_000, attempts: 0 });
  });

  it("propagates the loop signal to fn so it aborts when the budget elapses", async () => {
    const captured: AbortSignal[] = [];
    const error = await pollUntil(
      async (signal) => {
        captured.push(signal);
        await new Promise((resolve) => setTimeout(resolve, 100));
        return "done";
      },
      () => false,
      { intervalMs: 1, timeoutMs: 5 },
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(TimeoutError);
    expect(captured.length).toBe(1);
    const signal = captured[0];
    if (!signal) {
      throw new Error("expected fn to receive a signal");
    }
    expect(signal.aborted).toBe(true);
  });

  it("exponential backoff doubles the gap until the cap, then holds steady", async () => {
    const timestamps: number[] = [];
    await pollUntil(
      async () => {
        timestamps.push(performance.now());
        return timestamps.length;
      },
      (value) => value === 5,
      { intervalMs: 100, maxIntervalMs: 250, backoff: "exponential", timeoutMs: 5_000 },
    );

    expect(timestamps.length).toBe(5);
    const [gap0, gap1, gap2, gap3] = takeGaps4(timestamps);
    expect(gap1).toBeGreaterThan(gap0 * 1.5);
    expect(gap2).toBeGreaterThan(gap1);
    expect(gap2).toBeLessThan(MAX_GAP_WITH_SLACK);
    expect(gap3).toBeLessThan(MAX_GAP_WITH_SLACK);
    expect(Math.abs(gap3 - gap2)).toBeLessThan(SCHEDULER_SLACK_MS);
  });

  it("fixed backoff holds the interval constant across iterations", async () => {
    const timestamps: number[] = [];
    await pollUntil(
      async () => {
        timestamps.push(performance.now());
        return timestamps.length;
      },
      (value) => value === 4,
      { intervalMs: 100, maxIntervalMs: 1_000, backoff: "fixed", timeoutMs: 5_000 },
    );

    expect(timestamps.length).toBe(4);
    const [gap0, gap1, gap2] = takeGaps3(timestamps);
    expect(gap1).toBeLessThan(gap0 * 1.5);
    expect(gap2).toBeLessThan(gap0 * 1.5);
  });
});

const SCHEDULER_SLACK_MS = 75;
const MAX_GAP_WITH_SLACK = 250 + SCHEDULER_SLACK_MS;

function gapAt(timestamps: number[], index: number): number {
  const previous = timestamps[index];
  const current = timestamps[index + 1];
  if (previous === undefined || current === undefined) {
    throw new Error(`missing timestamp at index ${index}`);
  }
  return current - previous;
}

function takeGaps3(timestamps: number[]): [number, number, number] {
  return [gapAt(timestamps, 0), gapAt(timestamps, 1), gapAt(timestamps, 2)];
}

function takeGaps4(timestamps: number[]): [number, number, number, number] {
  return [gapAt(timestamps, 0), gapAt(timestamps, 1), gapAt(timestamps, 2), gapAt(timestamps, 3)];
}
