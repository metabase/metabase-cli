import { describe, expect, it } from "vitest";

import type { ScrollMetrics } from "./follow";
import { FOLLOW_BAND_PX, atEnd, canScroll, gapToEnd } from "./follow";

function metrics(offset: number, content: number): ScrollMetrics {
  return { offset, viewport: 600, content };
}

describe("deciding whether the timeline is at its end", () => {
  it("measures the gap between the last row and the edge above the composer", () => {
    expect(gapToEnd(metrics(400, 1200))).toBe(200);
  });

  it("counts the hard bottom as the end", () => {
    expect(atEnd(metrics(600, 1200))).toBe(true);
  });

  it("counts a hair above the bottom as the end", () => {
    expect(atEnd(metrics(600 - FOLLOW_BAND_PX, 1200))).toBe(true);
  });

  it("counts a screen of history above the bottom as away from the end", () => {
    expect(atEnd(metrics(600 - FOLLOW_BAND_PX - 1, 1200))).toBe(false);
  });
});

describe("deciding whether a gesture can move the viewport at all", () => {
  it("says no while the rows do not fill the screen", () => {
    expect(canScroll(metrics(0, 400))).toBe(false);
  });

  it("says yes once they overflow it", () => {
    expect(canScroll(metrics(0, 601))).toBe(true);
  });
});
