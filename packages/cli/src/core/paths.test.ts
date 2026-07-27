import { homedir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { configDir } from "./paths";

const ENV_KEYS = ["XDG_CONFIG_HOME", "APPDATA"] as const;

describe("configDir", () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const original = saved[key];
      if (original === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = original;
      }
    }
  });

  it("honors XDG_CONFIG_HOME on non-windows platforms", () => {
    if (process.platform === "win32") {
      return;
    }
    process.env["XDG_CONFIG_HOME"] = "/tmp/xdg-test";
    expect(configDir()).toBe("/tmp/xdg-test/metabase-cli");
  });

  it("falls back to ~/.config/metabase-cli when XDG_CONFIG_HOME is unset on non-windows", () => {
    if (process.platform === "win32") {
      return;
    }
    delete process.env["XDG_CONFIG_HOME"];
    expect(configDir()).toBe(join(homedir(), ".config", "metabase-cli"));
  });

  it("honors APPDATA on win32", () => {
    if (process.platform !== "win32") {
      return;
    }
    process.env["APPDATA"] = "C:\\Users\\test\\AppData\\Roaming";
    expect(configDir()).toBe("C:\\Users\\test\\AppData\\Roaming\\metabase-cli");
  });
});
