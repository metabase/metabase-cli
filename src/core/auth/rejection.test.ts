import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ConfigError, ValidationError } from "../errors";
import { clearRejection, readRejection, recordRejection, rejectionsFilePath } from "./rejection";
import { setupTempConfigHome, type TempConfigHome } from "./temp-config-home";

describe("rejection records", () => {
  let home: TempConfigHome;

  beforeEach(() => {
    home = setupTempConfigHome();
  });

  afterEach(() => {
    home.cleanup();
  });

  it("returns null when no rejection has been recorded", async () => {
    expect(await readRejection("default")).toBeNull();
  });

  it("round-trips a rejection", async () => {
    await recordRejection("staging", {
      reason: "Invalid or unauthorized API key",
      url: "https://staging.example.com",
    });
    const rejection = await readRejection("staging");
    expect(rejection?.reason).toBe("Invalid or unauthorized API key");
    expect(rejection?.url).toBe("https://staging.example.com");
    expect(rejection?.rejectedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("isolates rejections by profile", async () => {
    await recordRejection("a", { reason: "bad-a", url: "https://a.example.com" });
    await recordRejection("b", { reason: "bad-b", url: "https://b.example.com" });
    expect((await readRejection("a"))?.reason).toBe("bad-a");
    expect((await readRejection("b"))?.reason).toBe("bad-b");
  });

  it("overwrites a prior rejection for the same profile", async () => {
    await recordRejection("staging", { reason: "first", url: "https://m.example.com" });
    await recordRejection("staging", { reason: "second", url: "https://m.example.com" });
    expect((await readRejection("staging"))?.reason).toBe("second");
  });

  it("clearRejection removes the entry and reports whether one existed", async () => {
    await recordRejection("staging", {
      reason: "bad",
      url: "https://staging.example.com",
    });
    expect(await clearRejection("staging")).toBe(true);
    expect(await readRejection("staging")).toBeNull();
    expect(await clearRejection("staging")).toBe(false);
  });

  it("removes the file when the last rejection is cleared", async () => {
    if (process.platform === "win32") {
      return;
    }
    await recordRejection("only", { reason: "bad", url: "https://m.example.com" });
    await clearRejection("only");
    expect(() => statSync(rejectionsFilePath())).toThrow(/ENOENT/);
  });

  it("writes the file with 0600 perms", async () => {
    if (process.platform === "win32") {
      return;
    }
    await recordRejection("default", { reason: "bad", url: "https://m.example.com" });
    const mode = statSync(rejectionsFilePath()).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("stores the rejection map as JSON keyed by profile", async () => {
    await recordRejection("default", { reason: "bad", url: "https://m.example.com" });
    const stored: unknown = JSON.parse(readFileSync(rejectionsFilePath(), "utf8"));
    expect(stored).toMatchObject({
      default: {
        reason: "bad",
        url: "https://m.example.com",
        rejectedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      },
    });
  });

  it("throws ConfigError when the file contains malformed JSON", async () => {
    const path = rejectionsFilePath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "{ not json }");
    const error = await readRejection("default").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ConfigError);
    if (!(error instanceof ConfigError)) {
      throw new Error("expected ConfigError");
    }
    expect(error.message).toContain(path);
    expect(error.message).toContain("invalid JSON: ");
  });

  it("throws ValidationError when the file contains a missing-field record", async () => {
    const path = rejectionsFilePath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ default: { reason: "x" } }));
    const error = await readRejection("default").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ValidationError);
  });
});
