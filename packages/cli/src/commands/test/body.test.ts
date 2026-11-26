import { describe, expect, it } from "vitest";

import { ConfigError } from "@metabase/client/errors";

import { refuseForeignFields, TestPatch } from "./body";

function refusal(run: () => void): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return null;
}

describe("TestPatch", () => {
  it("accepts a fixed clock", () => {
    expect(TestPatch.parse({ now: "2026-10-13T00:00:00Z" })).toEqual({
      now: "2026-10-13T00:00:00Z",
    });
  });
});

describe("refuseForeignFields", () => {
  it.each(["transform", "card"] as const)("lets a %s test fix its clock", (type) => {
    expect(refusal(() => refuseForeignFields({ type, id: 3 }, { now: null }))).toBeNull();
  });

  it.each(["segment", "measure", "action"] as const)(
    "refuses `now` on a %s test, which fixes no clock",
    (type) => {
      const error = refusal(() =>
        refuseForeignFields({ type, id: 3 }, { now: "2026-10-13T00:00:00Z" }),
      );

      expect(error).toBeInstanceOf(ConfigError);
      expect(error).toHaveProperty("message", `a ${type} test takes no \`now\``);
    },
  );
});
