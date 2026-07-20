import { describe, expect, it } from "vitest";

import { hoistGlobalFlags } from "./global-flags";

describe("hoistGlobalFlags", () => {
  it("moves a leading value-taking global flag to after the verb chain", () => {
    expect(hoistGlobalFlags(["--profile", "staging", "card", "list"])).toEqual([
      "card",
      "list",
      "--profile",
      "staging",
    ]);
  });

  it("moves a leading boolean global flag to after the verb chain", () => {
    expect(hoistGlobalFlags(["--json", "card", "list"])).toEqual(["card", "list", "--json"]);
  });

  it("hoists a contiguous run of mixed global flags, preserving their order", () => {
    expect(hoistGlobalFlags(["--json", "--profile", "staging", "card", "list"])).toEqual([
      "card",
      "list",
      "--json",
      "--profile",
      "staging",
    ]);
  });

  it("hoists global flags addressed by their kebab alias", () => {
    expect(hoistGlobalFlags(["--api-key", "secret", "db", "list"])).toEqual([
      "db",
      "list",
      "--api-key",
      "secret",
    ]);
  });

  it("keeps the embedded value of an = form flag attached to the single token", () => {
    expect(hoistGlobalFlags(["--profile=staging", "card", "list"])).toEqual([
      "card",
      "list",
      "--profile=staging",
    ]);
  });

  it("hoists the negated form of a boolean global flag without swallowing a value", () => {
    expect(hoistGlobalFlags(["--no-full", "card", "get", "1"])).toEqual([
      "card",
      "get",
      "1",
      "--no-full",
    ]);
  });

  it("leaves args untouched when the global flag already follows the verb", () => {
    expect(hoistGlobalFlags(["card", "list", "--profile", "staging"])).toEqual([
      "card",
      "list",
      "--profile",
      "staging",
    ]);
  });

  it("does not hoist a leading non-global flag such as --help", () => {
    expect(hoistGlobalFlags(["--help"])).toEqual(["--help"]);
  });

  it("returns a copy when there are no leading global flags", () => {
    expect(hoistGlobalFlags(["card", "list"])).toEqual(["card", "list"]);
  });

  it("tolerates a trailing value-taking global flag with no value", () => {
    expect(hoistGlobalFlags(["--profile"])).toEqual(["--profile"]);
  });
});
