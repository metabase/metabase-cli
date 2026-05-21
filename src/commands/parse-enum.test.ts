import { describe, expect, it } from "vitest";
import { z } from "zod";

import { ConfigError } from "../core/errors";

import { parseEnumFlag } from "./parse-enum";

const Filter = z.enum(["all", "mine", "archived"]);

describe("parseEnumFlag", () => {
  it("returns the narrowed value for a member of the enum", () => {
    expect(parseEnumFlag("mine", Filter, "filter")).toBe("mine");
  });

  it("throws ConfigError listing the allowed values for a non-member", () => {
    expect(() => parseEnumFlag("bogus", Filter, "filter")).toThrow(
      new ConfigError('invalid filter: "bogus" (expected one of: all, mine, archived)'),
    );
  });

  it("uses the supplied name in the message", () => {
    expect(() => parseEnumFlag("", Filter, "preset")).toThrow(
      new ConfigError('invalid preset: "" (expected one of: all, mine, archived)'),
    );
  });
});
