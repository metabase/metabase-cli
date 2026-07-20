import { describe, expect, it } from "vitest";

import { ConfigError } from "../core/errors";
import { DEFAULT_INTERVAL_MS, DEFAULT_TIMEOUT_MS } from "../runtime/poll";

import { parseWaitFlags } from "./wait-flags";

describe("parseWaitFlags", () => {
  it("returns disabled with default schedule when no flags are passed", () => {
    expect(parseWaitFlags({})).toEqual({
      enabled: false,
      schedule: { intervalMs: DEFAULT_INTERVAL_MS, timeoutMs: DEFAULT_TIMEOUT_MS },
    });
  });

  it("enables waiting and honors --interval / --timeout overrides", () => {
    expect(parseWaitFlags({ wait: true, interval: "500", timeout: "30000" })).toEqual({
      enabled: true,
      schedule: { intervalMs: 500, timeoutMs: 30_000 },
    });
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
