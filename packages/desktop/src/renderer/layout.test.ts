import { describe, expect, it } from "vitest";

import { LAYOUT_MIN_WIDTH } from "../contracts/layout";

import { GROWTH, fitLayout, widthAfterDrag, widthAfterKey, widthRange } from "./layout";

const WIDE = 1440;

describe("fitLayout", () => {
  it("shows the chosen widths when the three columns fit", () => {
    expect(fitLayout({ sidebar: 300, sidePanel: 600, tree: 240 }, WIDE, "open")).toEqual({
      sidebar: 300,
      sidePanel: 600,
      tree: 240,
    });
  });

  it("holds each column inside its bounds", () => {
    expect(fitLayout({ sidebar: 40, sidePanel: 5000, tree: 9000 }, 4000, "open")).toEqual({
      sidebar: 208,
      sidePanel: 960,
      tree: 480,
    });
  });

  it("narrows the side panel first when the window is smaller than the chosen widths", () => {
    expect(fitLayout({ sidebar: 300, sidePanel: 700, tree: 224 }, 1200, "open")).toEqual({
      sidebar: 300,
      sidePanel: 500,
      tree: 224,
    });
  });

  it("narrows the sidebar once the side panel is at its minimum", () => {
    expect(
      fitLayout({ sidebar: 400, sidePanel: 700, tree: 300 }, LAYOUT_MIN_WIDTH, "open"),
    ).toEqual({
      sidebar: 208,
      sidePanel: 360,
      tree: 160,
    });
  });

  it("gives a closed side panel's room to the sidebar", () => {
    expect(
      fitLayout({ sidebar: 416, sidePanel: 700, tree: 224 }, LAYOUT_MIN_WIDTH, "closed"),
    ).toEqual({
      sidebar: 416,
      sidePanel: 700,
      tree: 224,
    });
  });
});

describe("widthRange", () => {
  it("lets the sidebar grow only as far as the main area's minimum allows beside the side panel", () => {
    expect(widthRange("sidebar", { sidebar: 256, sidePanel: 700 }, 1400, "open")).toEqual({
      min: 208,
      max: 300,
    });
  });

  it("is the side panel's own bounds in a wide window", () => {
    expect(widthRange("sidePanel", { sidebar: 256, sidePanel: 560 }, 2000, "open")).toEqual({
      min: 360,
      max: 960,
    });
  });

  it("never offers a maximum under the minimum", () => {
    expect(
      widthRange("sidePanel", { sidebar: 416, sidePanel: 360 }, LAYOUT_MIN_WIDTH, "open"),
    ).toEqual({
      min: 360,
      max: 360,
    });
  });
});

describe("widthAfterDrag", () => {
  const range = { min: 208, max: 416 };

  it("grows the sidebar as the pointer moves right", () => {
    expect(widthAfterDrag(256, 40, GROWTH.sidebar, range)).toBe(296);
  });

  it("grows the side panel as the pointer moves left", () => {
    expect(widthAfterDrag(400, -10.4, GROWTH.sidePanel, { min: 360, max: 960 })).toBe(410);
  });

  it("stops at the range's ends", () => {
    expect(widthAfterDrag(256, 500, GROWTH.sidebar, range)).toBe(416);
  });
});

describe("widthAfterKey", () => {
  const range = { min: 360, max: 960 };

  it("moves the handle the way the arrow points", () => {
    expect(widthAfterKey("ArrowLeft", 560, GROWTH.sidePanel, range)).toBe(576);
  });

  it("takes the column to its narrowest on Home and its widest on End", () => {
    expect([
      widthAfterKey("Home", 560, GROWTH.sidePanel, range),
      widthAfterKey("End", 560, GROWTH.sidePanel, range),
    ]).toEqual([360, 960]);
  });

  it("leaves every other key to the page", () => {
    expect(widthAfterKey("Enter", 560, GROWTH.sidePanel, range)).toBeNull();
  });
});
