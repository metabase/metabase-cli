import { describe, expect, it } from "vitest";
import { z } from "zod";

import { NonBlankText } from "@metabase/client/domain/text";
import { ConfigError } from "@metabase/client/errors";

import { parseTextFlag } from "./parse-text";

describe("parseTextFlag", () => {
  it("returns the value its field's schema accepts", () => {
    expect(parseTextFlag("Analysts", NonBlankText, "--name")).toBe("Analysts");
  });

  it("throws ConfigError naming the flag and the schema's reason", () => {
    expect(() => parseTextFlag("  ", NonBlankText, "--name")).toThrow(
      new ConfigError("--name must not be blank"),
    );
  });

  it("joins every reason the schema gives", () => {
    const Code = z
      .string()
      .min(3, "is too short")
      .regex(/^[A-Z]/, "must start upper-case");

    expect(() => parseTextFlag("ab", Code, "--code")).toThrow(
      new ConfigError("--code is too short; must start upper-case"),
    );
  });
});
