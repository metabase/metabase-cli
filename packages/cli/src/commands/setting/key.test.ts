import { assert, describe, expect, it } from "vitest";

import { ConfigError } from "@metabase/client/errors";

import { parseSettingKey } from "./key";

function thrownBy(run: () => void): unknown {
  try {
    run();
  } catch (error: unknown) {
    return error;
  }
  throw new Error("expected the call to throw");
}

describe("parseSettingKey", () => {
  it("trims and returns a valid kebab-case key", () => {
    expect(parseSettingKey("  remote-sync-branch  ")).toBe("remote-sync-branch");
  });

  it("rejects a key that is not a kebab-case identifier", () => {
    const error = thrownBy(() => parseSettingKey("not a key!"));
    expect(error).toBeInstanceOf(ConfigError);
    assert(error instanceof ConfigError, "expected ConfigError");
    expect(error.message).toBe(
      'invalid setting key: "not a key!" (expected kebab-case identifier)',
    );
  });
});
