import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { ConfigError, ValidationError } from "../core/errors";
import { parseJson, parseJsonResult } from "./json";

const Person = z.object({ id: z.number(), name: z.string() });

function captureThrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (caught) {
    return caught;
  }
  throw new Error("expected the callback to throw");
}

describe("parseJson", () => {
  it("parses valid JSON that matches the schema", () => {
    expect(parseJson('{"id":1,"name":"x"}', Person)).toEqual({ id: 1, name: "x" });
  });

  it("throws ConfigError mentioning the source on malformed JSON", () => {
    const error = captureThrown(() => parseJson("{ not json }", Person, { source: "--body" }));
    expect(error).toBeInstanceOf(ConfigError);
    if (!(error instanceof ConfigError)) {
      throw new Error("expected ConfigError");
    }
    expect(error.message).toContain("--body: invalid JSON: ");
  });

  it("throws ValidationError listing zod issues on shape mismatch", () => {
    const error = captureThrown(() =>
      parseJson('{"id":"not-a-number","name":"x"}', Person, { source: "--body" }),
    );
    expect(error).toBeInstanceOf(ValidationError);
    if (!(error instanceof ValidationError)) {
      throw new Error("expected ValidationError");
    }
    expect(error.message).toContain("--body");
    expect(error.developerDetail).toEqual({
      source: "--body",
      zodIssues: [
        {
          code: "invalid_type",
          expected: "number",
          path: ["id"],
          message: "Invalid input: expected number, received string",
        },
      ],
    });
  });

  it("uses <input> as the default source when none is provided", () => {
    const error = captureThrown(() => parseJson('{"id":"x","name":"y"}', Person));
    expect(error).toBeInstanceOf(ValidationError);
    if (!(error instanceof ValidationError)) {
      throw new Error("expected ValidationError");
    }
    expect(error.developerDetail.source).toBe("<input>");
  });

  it("accepts z.unknown() for opaque passthrough payloads", () => {
    expect(parseJson('{"anything":[1,2]}', z.unknown())).toEqual({ anything: [1, 2] });
  });
});

describe("parseJsonResult", () => {
  it("returns ok with the parsed value when JSON and schema both succeed", () => {
    expect(parseJsonResult('{"id":1,"name":"x"}', Person)).toEqual({
      ok: true,
      value: { id: 1, name: "x" },
    });
  });

  it("returns a ConfigError on malformed JSON", () => {
    const result = parseJsonResult("{ not json }", Person, { source: "--body" });
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected failure");
    }
    expect(result.error).toBeInstanceOf(ConfigError);
    expect(result.error.message).toContain("--body: invalid JSON: ");
  });

  it("returns a ValidationError when the schema rejects the value", () => {
    const result = parseJsonResult('{"id":"x","name":"y"}', Person, { source: "--body" });
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected failure");
    }
    expect(result.error).toBeInstanceOf(ValidationError);
    expect(result.error.message).toContain("--body");
  });

  it("returns ok:true with null when the schema accepts a successful null parse", () => {
    expect(parseJsonResult("null", z.null())).toEqual({ ok: true, value: null });
  });
});

describe("parseJsonResult round-trip with z.unknown()", () => {
  it.each<[string, unknown]>([
    ["null", null],
    ["true", true],
    ["false", false],
    ["0", 0],
    ["-1", -1],
    ["1.5", 1.5],
    ['""', ""],
    ['"abc"', "abc"],
    ["[]", []],
    ["[1,2,3]", [1, 2, 3]],
    ["{}", {}],
    ['{"a":1,"b":[true,null]}', { a: 1, b: [true, null] }],
    ['{"nested":{"deep":{"value":42}}}', { nested: { deep: { value: 42 } } }],
  ])("round-trip %j → %j", (input, expected) => {
    expect(parseJsonResult(input, z.unknown())).toEqual({ ok: true, value: expected });
  });
});

describe("parseJsonResult on non-JSON strings", () => {
  it.each(["", "not json", "{", "{,}", '{"unterminated":', "[1,2,", "undefined", "NaN"])(
    "returns full ConfigError envelope for %j",
    (input) => {
      const result = parseJsonResult(input, z.unknown(), { source: "fixture" });
      expect(result.ok).toBe(false);
      if (result.ok) {
        throw new Error("expected failure");
      }
      expect(result.error).toBeInstanceOf(ConfigError);
      expect(result.error.message).toContain("fixture: invalid JSON: ");
    },
  );
});

describe("parseJsonResult on schema mismatch", () => {
  it.each<[string, string]>([
    ["123", "Invalid input: expected string, received number"],
    ["true", "Invalid input: expected string, received boolean"],
    ["null", "Invalid input: expected string, received null"],
    ["[]", "Invalid input: expected string, received array"],
    ['{"a":1}', "Invalid input: expected string, received object"],
  ])("returns full ValidationError envelope for %j vs z.string()", (input, expectedMessage) => {
    const result = parseJsonResult(input, z.string(), { source: "fixture" });
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected failure");
    }
    if (!(result.error instanceof ValidationError)) {
      throw new Error("expected ValidationError");
    }
    expect(result.error.message).toBe("fixture: value did not match expected schema");
    expect(result.error.developerDetail).toEqual({
      source: "fixture",
      zodIssues: [
        {
          code: "invalid_type",
          expected: "string",
          path: [],
          message: expectedMessage,
        },
      ],
    });
  });
});

describe("parseJson property tests", () => {
  it("property: round-trips any JSON.stringify(value) through parseJson with z.unknown()", () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        const serialized = JSON.stringify(value);
        expect(parseJson(serialized, z.unknown())).toEqual(value);
      }),
    );
  });

  it("property: any string that JSON.parse rejects produces a ConfigError with the source prefix", () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        let isValidJson = true;
        try {
          JSON.parse(input);
        } catch {
          isValidJson = false;
        }
        fc.pre(!isValidJson);
        const result = parseJsonResult(input, z.unknown(), { source: "fixture" });
        expect(result.ok).toBe(false);
        if (result.ok) {
          throw new Error("expected failure");
        }
        expect(result.error).toBeInstanceOf(ConfigError);
        expect(result.error.message.startsWith("fixture: invalid JSON: ")).toBe(true);
      }),
    );
  });

  it("property: any value that does not match the schema produces a ValidationError carrying the source", () => {
    fc.assert(
      fc.property(fc.integer(), (value) => {
        const serialized = JSON.stringify(value);
        const result = parseJsonResult(serialized, z.string(), { source: "fixture" });
        expect(result.ok).toBe(false);
        if (result.ok) {
          throw new Error("expected failure");
        }
        expect(result.error).toBeInstanceOf(ValidationError);
        if (!(result.error instanceof ValidationError)) {
          throw new Error("expected ValidationError");
        }
        expect(result.error.developerDetail.source).toBe("fixture");
      }),
    );
  });

  it("property: source prefix is omitted when no source is supplied", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }).filter((value) => !isParseableJson(value)),
        (input) => {
          const result = parseJsonResult(input, z.unknown());
          expect(result.ok).toBe(false);
          if (result.ok) {
            throw new Error("expected failure");
          }
          expect(result.error).toBeInstanceOf(ConfigError);
          expect(result.error.message.startsWith("invalid JSON: ")).toBe(true);
        },
      ),
    );
  });
});

function isParseableJson(input: string): boolean {
  try {
    JSON.parse(input);
    return true;
  } catch {
    return false;
  }
}
