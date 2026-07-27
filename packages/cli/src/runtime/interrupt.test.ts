import { afterEach, assert, beforeEach, describe, expect, it, vi } from "vitest";

import { AbortError } from "@metabase/client/errors";

import { abortOnInterrupt, INTERRUPT_EXIT_CODE, interruptSignal } from "./interrupt";

describe("abortOnInterrupt", () => {
  it("aborts the shared signal with the taxonomy's interrupt reason", () => {
    expect(interruptSignal.aborted).toBe(false);

    abortOnInterrupt();

    expect(interruptSignal.aborted).toBe(true);
    const reason: unknown = interruptSignal.reason;
    assert(reason instanceof AbortError, "expected AbortError");
    expect([reason.message, reason.category]).toEqual(["interrupted", "abort"]);
  });
});

describe("INTERRUPT_EXIT_CODE", () => {
  it("is the code the CLI maps the interrupt reason's own category to", () => {
    expect(INTERRUPT_EXIT_CODE).toBe(130);
  });
});

describe("installInterruptHandler", () => {
  const FORCED_EXIT_GRACE_MS = 2_000;

  interface InstalledHandler {
    listener: NodeJS.SignalsListener;
    signal: AbortSignal;
    exits: number[];
  }

  let preexisting: readonly unknown[] = [];

  function addedSigintListeners(): NodeJS.SignalsListener[] {
    return process
      .listeners("SIGINT")
      .filter((listener): listener is NodeJS.SignalsListener => !preexisting.includes(listener));
  }

  // The interrupt module is reloaded per test so each starts on an unaborted signal — the
  // process-wide singleton the other suites use latches on the first abort and never resets.
  async function install(): Promise<InstalledHandler> {
    vi.resetModules();
    const fresh = await import("./interrupt");
    const exits: number[] = [];
    fresh.installInterruptHandler((code) => exits.push(code));
    const added = addedSigintListeners();
    expect(added).toHaveLength(1);
    const [listener] = added;
    assert(listener !== undefined, "expected a SIGINT listener");
    return { listener, signal: fresh.interruptSignal, exits };
  }

  beforeEach(() => {
    vi.useFakeTimers();
    preexisting = process.listeners("SIGINT");
  });

  afterEach(() => {
    for (const listener of addedSigintListeners()) {
      process.removeListener("SIGINT", listener);
    }
    vi.useRealTimers();
  });

  it("aborts the shared signal on the first SIGINT, leaving the command to unwind itself", async () => {
    const { listener, signal, exits } = await install();

    listener("SIGINT");

    expect(signal.aborted).toBe(true);
    expect(exits).toEqual([]);
  });

  it("ends the process once the grace period expires with the command still running", async () => {
    const { listener, exits } = await install();

    listener("SIGINT");
    vi.advanceTimersByTime(FORCED_EXIT_GRACE_MS - 1);
    expect(exits).toEqual([]);
    vi.advanceTimersByTime(1);

    expect(exits).toEqual([130]);
  });

  it("ends the process on the second SIGINT rather than waiting out the grace period", async () => {
    const { listener, exits } = await install();

    listener("SIGINT");
    listener("SIGINT");

    expect(exits).toEqual([130]);
  });
});
