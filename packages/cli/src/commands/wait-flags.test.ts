import { describe, expect, it } from "vitest";

import { ConfigError } from "@metabase/client/errors";
import { DEFAULT_INTERVAL_MS, DEFAULT_TIMEOUT_MS } from "@metabase/client/poll";

import { interruptSignal } from "../runtime/interrupt";
import { parseWaitFlags } from "./wait-flags";

describe("parseWaitFlags", () => {
  it("returns disabled with default schedule when no flags are passed", () => {
    expect(parseWaitFlags({})).toEqual({
      enabled: false,
      schedule: {
        intervalMs: DEFAULT_INTERVAL_MS,
        timeoutMs: DEFAULT_TIMEOUT_MS,
        signal: interruptSignal,
      },
    });
  });

  it("enables waiting and honors --interval / --timeout overrides", () => {
    expect(parseWaitFlags({ wait: true, interval: "500", timeout: "30000" })).toEqual({
      enabled: true,
      schedule: { intervalMs: 500, timeoutMs: 30_000, signal: interruptSignal },
    });
  });

  // Two distinct AbortSignals compare equal under toEqual (neither carries an own enumerable
  // property), so identity is the only assertion that proves a poll loop is Ctrl-C-interruptible.
  it("carries the process interrupt signal itself, not some other signal", () => {
    expect(parseWaitFlags({ wait: true }).schedule.signal).toBe(interruptSignal);
  });

  it("rejects a non-numeric --interval with ConfigError", () => {
    expect(() => parseWaitFlags({ wait: true, interval: "fast" })).toThrowError(
      new ConfigError(`invalid interval: "fast" (expected integer)`),
    );
  });

  it("rejects a non-numeric --timeout with ConfigError", () => {
    expect(() => parseWaitFlags({ wait: true, timeout: "soon" })).toThrowError(
      new ConfigError(`invalid timeout: "soon" (expected integer)`),
    );
  });
});
