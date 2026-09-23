import { describe, expect, it } from "vitest";

import { chromeOptions, windowChrome } from "./window";

describe("window chrome", () => {
  it("hides the title bar on macOS and centres the traffic lights on the top strip", () => {
    expect(chromeOptions(windowChrome("darwin"), "light")).toEqual({
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 16, y: 17 },
    });
  });

  it("tells the renderer to keep the leading corner clear on macOS", () => {
    expect(windowChrome("darwin")).toEqual({ kind: "traffic-lights", inset: 68 });
  });

  it("draws the controls overlay on Linux and Windows", () => {
    expect(windowChrome("linux")).toEqual({ kind: "controls-overlay" });
    expect(windowChrome("win32")).toEqual({ kind: "controls-overlay" });
  });

  it("draws the overlay's buttons in the ink of the active theme", () => {
    const overlay = windowChrome("linux");
    expect(chromeOptions(overlay, "light")).toEqual({
      titleBarStyle: "hidden",
      titleBarOverlay: { color: "#00000000", symbolColor: "#1f2124", height: 48 },
    });
    expect(chromeOptions(overlay, "dark")).toEqual({
      titleBarStyle: "hidden",
      titleBarOverlay: { color: "#00000000", symbolColor: "#f2f3f4", height: 48 },
    });
  });
});
