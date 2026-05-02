import { describe, expect, it } from "vitest";

import { backoffDelay } from "./retry";

describe("backoffDelay", () => {
  it("scales exponentially with attempt when no Retry-After is present", () => {
    const delays = [0, 1, 2].map((attempt) => backoffDelay({ attempt }));
    expect(delays).toEqual([250, 500, 1000]);
  });

  it("caps the exponential backoff at 8000ms", () => {
    expect(backoffDelay({ attempt: 20 })).toBe(8000);
  });

  it("honors numeric Retry-After header in seconds", () => {
    expect(backoffDelay({ attempt: 0, retryAfterHeader: "2" })).toBe(2000);
  });

  it("honors HTTP-date Retry-After header", () => {
    const future = new Date(Date.now() + 5_000).toUTCString();
    const delay = backoffDelay({ attempt: 0, retryAfterHeader: future });
    expect(delay).toBeGreaterThanOrEqual(4_000);
    expect(delay).toBeLessThanOrEqual(5_000);
  });

  it("ignores malformed Retry-After header and falls back to exponential backoff", () => {
    expect(backoffDelay({ attempt: 0, retryAfterHeader: "not a number" })).toBe(250);
  });
});
