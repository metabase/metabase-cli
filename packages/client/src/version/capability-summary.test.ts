import { describe, expect, it } from "vitest";

import { summarizeCapabilities } from "./capability-summary";
import { KNOWN_RANGE } from "./profile";

describe("summarizeCapabilities", () => {
  it("reports the oldest known major as the floor of no features at all", () => {
    expect(summarizeCapabilities([])).toEqual({ minVersion: KNOWN_RANGE.min });
  });

  it("reports the highest `since` among the features as the floor", () => {
    expect(summarizeCapabilities(["transforms", "transformJobActivation"])).toEqual({
      minVersion: 61,
    });
  });

  it("carries the one premium feature the list needs", () => {
    expect(summarizeCapabilities(["library"])).toEqual({ minVersion: 59, tokenFeature: "library" });
  });

  it("names the same premium feature once when several features share it", () => {
    expect(summarizeCapabilities(["library", "library"])).toEqual({
      minVersion: 59,
      tokenFeature: "library",
    });
  });

  it("refuses a list that needs two premium features, which one field cannot carry", () => {
    expect(() => summarizeCapabilities(["library", "remoteSync"])).toThrow(
      "a capability summary names one premium feature, got 2: library, remote_sync",
    );
  });
});
