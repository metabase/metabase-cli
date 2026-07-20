import { describe, expect, it } from "vitest";

import { ConfigError } from "../core/errors";

import { requireBothOrNeither } from "./flag-pair";

describe("requireBothOrNeither", () => {
  it("returns null when both flags are unset", () => {
    expect(
      requireBothOrNeither(
        { name: "--name", value: undefined },
        { name: "--group-id", value: undefined },
      ),
    ).toBeNull();
  });

  it("returns null when both flags are empty strings", () => {
    expect(
      requireBothOrNeither({ name: "--name", value: "" }, { name: "--group-id", value: "" }),
    ).toBeNull();
  });

  it("returns the pair when both flags are set", () => {
    expect(
      requireBothOrNeither(
        { name: "--name", value: "deploy-bot" },
        { name: "--group-id", value: "2" },
      ),
    ).toEqual({ first: "deploy-bot", second: "2" });
  });

  it("throws ConfigError naming the missing first flag", () => {
    expect(() =>
      requireBothOrNeither(
        { name: "--name", value: undefined },
        { name: "--group-id", value: "2" },
      ),
    ).toThrowError(new ConfigError("--name is required when using --group-id"));
  });

  it("throws ConfigError naming the missing second flag", () => {
    expect(() =>
      requireBothOrNeither(
        { name: "--name", value: "deploy-bot" },
        { name: "--group-id", value: undefined },
      ),
    ).toThrowError(new ConfigError("--group-id is required when using --name"));
  });
});
