import { describe, expect, it } from "vitest";

import { ConfigError } from "@metabase/client/errors";

import { fieldSearchValue } from "./search";

describe("fieldSearchValue", () => {
  it("lets a search with no value stand on its limit", () => {
    expect(fieldSearchValue(undefined, 4)).toBeUndefined();
  });

  it("carries a value with or without a limit", () => {
    expect(fieldSearchValue("ada", undefined)).toBe("ada");
    expect(fieldSearchValue("ada", 4)).toBe("ada");
  });

  it("refuses a search with neither value nor limit before any request", () => {
    expect(() => fieldSearchValue(undefined, undefined)).toThrow(ConfigError);
    expect(() => fieldSearchValue(undefined, undefined)).toThrow(
      "--limit is required when --value is absent",
    );
  });

  it("refuses a blank value rather than reading it as no value", () => {
    expect(() => fieldSearchValue("  ", 4)).toThrow(ConfigError);
    expect(() => fieldSearchValue("  ", 4)).toThrow("invalid --value: must not be blank");
  });
});
