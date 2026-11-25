import type { CommandMeta } from "citty";
import { describe, expect, it } from "vitest";

import { isShortAlias, kebabFlagName, resolveCitty, toAliasArray } from "./citty";

describe("resolveCitty", () => {
  const meta: CommandMeta = { name: "demo", description: "demo cmd" };

  it("returns a plain value unchanged", async () => {
    expect(await resolveCitty(meta)).toEqual({ name: "demo", description: "demo cmd" });
  });

  it("invokes a synchronous thunk", async () => {
    expect(await resolveCitty(() => meta)).toEqual({ name: "demo", description: "demo cmd" });
  });

  it("awaits an asynchronous thunk", async () => {
    expect(await resolveCitty(async () => meta)).toEqual({
      name: "demo",
      description: "demo cmd",
    });
  });

  it("returns undefined for an absent value", async () => {
    expect(await resolveCitty(undefined)).toBeUndefined();
  });
});

describe("toAliasArray", () => {
  it("returns an empty array for an absent alias", () => {
    expect(toAliasArray(undefined)).toEqual([]);
  });

  it("wraps a single alias in an array", () => {
    expect(toAliasArray("max-bytes")).toEqual(["max-bytes"]);
  });

  it("returns a list of aliases unchanged", () => {
    expect(toAliasArray(["m", "model-id"])).toEqual(["m", "model-id"]);
  });
});

describe("kebabFlagName", () => {
  it("spells each word of a flag key in lower case, joined by hyphens", () => {
    const keys = ["maxBytes", "skipPreflight", "include-inactive", "id"];

    expect(keys.map(kebabFlagName)).toEqual([
      "max-bytes",
      "skip-preflight",
      "include-inactive",
      "id",
    ]);
  });
});

describe("isShortAlias", () => {
  it("holds for a one-letter alias only", () => {
    expect(["p", "max-bytes", "mb"].map(isShortAlias)).toEqual([true, false, false]);
  });
});
