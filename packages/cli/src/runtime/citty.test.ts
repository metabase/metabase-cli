import type { ArgsDef, CommandMeta } from "citty";
import { describe, expect, it } from "vitest";

import { collectRepeatedFlag, resolveCitty, toAliasArray } from "./citty";

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

describe("collectRepeatedFlag", () => {
  const argsDef: ArgsDef = {
    assert: { type: "string", alias: "a" },
    expected: { type: "string" },
  };

  it("collects every occurrence of a repeated flag in order", () => {
    const raw = ["173", "--assert", "a.sql", "--assert", "b.sql"];
    expect(collectRepeatedFlag(raw, "assert", argsDef)).toEqual(["a.sql", "b.sql"]);
  });

  it("handles the --flag=value form", () => {
    const raw = ["--assert=a.sql", "--assert", "b.sql"];
    expect(collectRepeatedFlag(raw, "assert", argsDef)).toEqual(["a.sql", "b.sql"]);
  });

  it("collects aliases of the flag", () => {
    const raw = ["-a", "a.sql", "--assert", "b.sql"];
    expect(collectRepeatedFlag(raw, "assert", argsDef)).toEqual(["a.sql", "b.sql"]);
  });

  it("returns an empty array when the flag is absent", () => {
    expect(collectRepeatedFlag(["--expected", "out.csv"], "assert", argsDef)).toEqual([]);
  });

  it("ignores tokens after the -- separator", () => {
    const raw = ["--assert", "a.sql", "--", "--assert", "b.sql"];
    expect(collectRepeatedFlag(raw, "assert", argsDef)).toEqual(["a.sql"]);
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
