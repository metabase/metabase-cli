import { describe, expect, it } from "vitest";

import { ConfigError } from "@metabase/client/errors";

import { parseEntityRef, parseTestRef, testRefText } from "./test-ref";

describe("parseEntityRef", () => {
  it("reads the entity under test", () => {
    expect(parseEntityRef("card:12")).toEqual({ type: "card", id: 12 });
  });

  it("refuses a test ref", () => {
    expect(() => parseEntityRef("card-test:12")).toThrow(
      new ConfigError(
        'invalid --id: "card-test:12" names a test; this command takes the entity under test, <type>:<id>, such as card:12',
      ),
    );
  });

  it("refuses a type no test covers", () => {
    expect(() => parseEntityRef("dashboard:7")).toThrow(
      new ConfigError(
        'invalid --id: "dashboard:7" (expected <type>:<id>, such as card:12, where <type> is one of: transform, card, segment, measure, action)',
      ),
    );
  });
});

describe("parseTestRef", () => {
  it("reads a test", () => {
    expect(parseTestRef("segment-test:34")).toEqual({ type: "segment", id: 34 });
  });

  it("refuses an entity ref", () => {
    expect(() => parseTestRef("card:34")).toThrow(
      new ConfigError(
        'invalid --id: "card:34" names an entity; this command takes a test, <type>-test:<id>, such as card-test:34',
      ),
    );
  });

  it("refuses a ref without an id", () => {
    expect(() => parseTestRef("card-test")).toThrow(
      new ConfigError(
        'invalid --id: "card-test" (expected <type>-test:<id>, such as card-test:34)',
      ),
    );
  });

  it("refuses an id below 1", () => {
    expect(() => parseTestRef("card-test:0")).toThrow(
      new ConfigError("invalid --id: 0 (must be ≥ 1)"),
    );
  });
});

describe("testRefText", () => {
  it("writes the ref it was read from", () => {
    expect(testRefText(parseTestRef("action-test:9"))).toBe("action-test:9");
  });
});
