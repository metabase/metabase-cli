import type { CommandMeta } from "citty";
import { describe, expect, it } from "vitest";

import { resolveCitty, toAliasArray } from "./citty";

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
