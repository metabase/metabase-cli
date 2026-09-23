import { describe, expect, it } from "vitest";

import { updateToast } from "./updates";

describe("updateToast", () => {
  it("stays hidden while nothing asks for the user", () => {
    expect([
      updateToast({ kind: "off", reason: "test-mode" }),
      updateToast({ kind: "idle" }),
      updateToast({ kind: "checking" }),
      updateToast({ kind: "current", version: "1.0.0" }),
    ]).toEqual([null, null, null, null]);
  });

  it("offers the download of an available version", () => {
    expect(updateToast({ kind: "available", version: "1.2.0" })).toEqual({
      key: "available:1.2.0",
      message: "RDE 1.2.0 is available.",
      action: { kind: "download", label: "Download" },
    });
  });

  it("keeps one key through a download's progress, so a dismissal outlasts it", () => {
    const early = updateToast({ kind: "downloading", version: "1.2.0", percent: 12.7 });
    const late = updateToast({ kind: "downloading", version: "1.2.0", percent: 88 });
    expect([early, late]).toEqual([
      { key: "downloading:1.2.0", message: "Downloading 1.2.0: 12%", action: null },
      { key: "downloading:1.2.0", message: "Downloading 1.2.0: 88%", action: null },
    ]);
  });

  it("offers the restart once the download is in", () => {
    expect(updateToast({ kind: "ready", version: "1.2.0" })).toEqual({
      key: "ready:1.2.0",
      message: "RDE 1.2.0 is ready. Restart to update.",
      action: { kind: "install", label: "Restart" },
    });
  });

  it("shows a failed download and leaves a failed background check to the log", () => {
    expect([
      updateToast({ kind: "error", step: "download", message: "net::ERR_CONNECTION_RESET" }),
      updateToast({ kind: "error", step: "check", message: "net::ERR_INTERNET_DISCONNECTED" }),
    ]).toEqual([
      {
        key: "error:net::ERR_CONNECTION_RESET",
        message: "The update did not download: net::ERR_CONNECTION_RESET",
        action: null,
      },
      null,
    ]);
  });
});
