import * as fc from "fast-check";
import { assert, describe, expect, it } from "vitest";
import { z } from "zod";

import { ConfigError, ValidationError } from "../core/errors";
import { parseJson, parseJsonOrPlain, parseJsonResult } from "./json";

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
    assert(error instanceof ConfigError, "expected ConfigError");
    expect(error.message).toContain("--body: invalid JSON: ");
  });

  it("throws ValidationError listing zod issues on shape mismatch", () => {
    const error = captureThrown(() =>
      parseJson('{"id":"not-a-number","name":"x"}', Person, { source: "--body" }),
    );
    assert(error instanceof ValidationError, "expected ValidationError");
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
    assert(error instanceof ValidationError, "expected ValidationError");
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
    assert(!result.ok, "expected failure");
    assert(result.error instanceof ConfigError, "expected ConfigError");
    expect(result.error.message).toContain("--body: invalid JSON: ");
  });

  it("returns a ValidationError when the schema rejects the value", () => {
    const result = parseJsonResult('{"id":"x","name":"y"}', Person, { source: "--body" });
    assert(!result.ok, "expected failure");
    assert(result.error instanceof ValidationError, "expected ValidationError");
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
      assert(!result.ok, "expected failure");
      assert(result.error instanceof ConfigError, "expected ConfigError");
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
    assert(!result.ok, "expected failure");
    assert(result.error instanceof ValidationError, "expected ValidationError");
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
  it("property: parseJson agrees with JSON.parse on any valid JSON text", () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        const serialized = JSON.stringify(value);
        expect(parseJson(serialized, z.unknown())).toEqual(JSON.parse(serialized));
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
        assert(!result.ok, "expected failure");
        assert(result.error instanceof ConfigError, "expected ConfigError");
        expect(result.error.message.startsWith("fixture: invalid JSON: ")).toBe(true);
      }),
    );
  });

  it("property: any value that does not match the schema produces a ValidationError carrying the source", () => {
    fc.assert(
      fc.property(fc.integer(), (value) => {
        const serialized = JSON.stringify(value);
        const result = parseJsonResult(serialized, z.string(), { source: "fixture" });
        assert(!result.ok, "expected failure");
        assert(result.error instanceof ValidationError, "expected ValidationError");
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
          assert(!result.ok, "expected failure");
          assert(result.error instanceof ConfigError, "expected ConfigError");
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

describe("parseJsonOrPlain", () => {
  it("parses JSON when content-type is application/json", () => {
    expect(parseJsonOrPlain('{"id":1,"name":"x"}', "application/json", Person)).toEqual({
      id: 1,
      name: "x",
    });
  });

  it("parses JSON when content-type carries charset alongside application/json", () => {
    expect(
      parseJsonOrPlain('{"id":1,"name":"x"}', "application/json; charset=utf-8", Person),
    ).toEqual({ id: 1, name: "x" });
  });

  it("treats text/plain bare strings as JSON string literals", () => {
    expect(parseJsonOrPlain("agent/shipments-analysis", "text/plain", z.string())).toBe(
      "agent/shipments-analysis",
    );
  });

  it("treats a missing content-type as a bare string", () => {
    expect(parseJsonOrPlain("agent/shipments-analysis", null, z.string())).toBe(
      "agent/shipments-analysis",
    );
  });

  it("treats an empty body with text/plain as an empty string", () => {
    expect(parseJsonOrPlain("", "text/plain", z.string())).toBe("");
  });

  it("preserves bare strings that contain JSON-special characters", () => {
    expect(parseJsonOrPlain('he said "hi"\nline2', "text/plain", z.string())).toBe(
      'he said "hi"\nline2',
    );
  });

  it("rejects schema mismatches on JSON content with ValidationError", () => {
    const error = captureThrown(() =>
      parseJsonOrPlain('{"id":"x","name":"y"}', "application/json", Person, { source: "fixture" }),
    );
    assert(error instanceof ValidationError, "expected ValidationError");
    expect(error.message).toBe("fixture: value did not match expected schema");
    expect(error.developerDetail).toEqual({
      source: "fixture",
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

  it("falls back to a bare string when JSON parsing fails on application/json content", () => {
    expect(parseJsonOrPlain("read-write", "application/json", z.string())).toBe("read-write");
  });

  it("falls back to a bare string when application/json carries a charset and the body is bare text", () => {
    expect(parseJsonOrPlain("read-write", "application/json; charset=utf-8", z.string())).toBe(
      "read-write",
    );
  });

  it("surfaces the bare-string fallback through the schema when the shape disagrees", () => {
    const error = captureThrown(() =>
      parseJsonOrPlain("read-write", "application/json", Person, { source: "fixture" }),
    );
    assert(error instanceof ValidationError, "expected ValidationError");
    expect(error.message).toBe("fixture: value did not match expected schema");
    expect(error.developerDetail).toEqual({
      source: "fixture",
      zodIssues: [
        {
          code: "invalid_type",
          expected: "object",
          path: [],
          message: "Invalid input: expected object, received string",
        },
      ],
    });
  });

  it("rejects schema mismatches on plain-text content with ValidationError", () => {
    const error = captureThrown(() =>
      parseJsonOrPlain("not-an-object", "text/plain", Person, { source: "fixture" }),
    );
    assert(error instanceof ValidationError, "expected ValidationError");
    expect(error.message).toBe("fixture: value did not match expected schema");
    expect(error.developerDetail).toEqual({
      source: "fixture",
      zodIssues: [
        {
          code: "invalid_type",
          expected: "object",
          path: [],
          message: "Invalid input: expected object, received string",
        },
      ],
    });
  });

  it("does not treat application/json-prefixed but other content as JSON when prefix is absent", () => {
    expect(parseJsonOrPlain("read-write", "text/plain", z.string())).toBe("read-write");
  });
});
