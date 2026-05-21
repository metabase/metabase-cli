import { assert, describe, expect, it } from "vitest";
import { z } from "zod";

import {
  AbortError,
  ConfigError,
  formatZodIssue,
  MetabaseError,
  ResponseShapeError,
  toMetabaseError,
  UnknownError,
  ValidationError,
} from "./errors";
import { HttpError } from "./http/errors";

describe("toMetabaseError", () => {
  it("passes MetabaseError instances through unchanged", () => {
    const original = new ConfigError("invalid flag");
    expect(toMetabaseError(original)).toBe(original);
  });

  it("preserves an HttpError instance and its developer detail", () => {
    const httpError = new HttpError({
      status: 401,
      statusText: "Unauthorized",
      method: "GET",
      url: "https://example.com/api/user/current",
      responseHeaders: { "content-type": "application/json" },
      rawBody: '{"message":"bad key"}',
    });
    const result = toMetabaseError(httpError);
    expect(result).toBe(httpError);
    expect(result.exitCode).toBe(1);
    expect(result.userMessage).toBe("bad key");
  });

  it("maps a ZodError to a ConfigError with exit code 2", () => {
    const zodError = z.object({ name: z.string() }).safeParse({ name: 42 });
    assert(!zodError.success, "expected zod failure");
    const result = toMetabaseError(zodError.error);
    expect(result).toBeInstanceOf(ConfigError);
    expect(result.exitCode).toBe(2);
    expect(result.userMessage).toContain("name");
  });

  it("wraps a generic Error as UnknownError with exit code 1 and preserves the message", () => {
    const original = new Error("kaboom");
    const result = toMetabaseError(original);
    expect(result).toBeInstanceOf(UnknownError);
    expect(result.exitCode).toBe(1);
    expect(result.userMessage).toBe("kaboom");
    expect(result.developerDetail).toEqual({
      originalMessage: "kaboom",
      stack: original.stack ?? null,
    });
  });

  it("wraps a non-Error value as UnknownError with stringified message", () => {
    const result = toMetabaseError("plain string");
    expect(result).toBeInstanceOf(UnknownError);
    expect(result.exitCode).toBe(1);
    expect(result.userMessage).toBe("plain string");
    expect(result.developerDetail).toEqual({ originalMessage: "plain string", stack: null });
  });
});

describe("HttpError sanitization at the print site", () => {
  it("strips a known secret from the developer-detail body", () => {
    const apiKey = "mb_abcdef0123456789";
    const httpError = new HttpError({
      status: 500,
      statusText: "Internal Server Error",
      method: "POST",
      url: "https://example.com/api/setting",
      responseHeaders: { authorization: `Bearer ${apiKey}` },
      rawBody: `{"errors":{"token":"${apiKey}"}}`,
      redactionContext: { knownSecrets: new Set([apiKey]) },
    });
    const handled = toMetabaseError(httpError);
    expect(handled).toBeInstanceOf(HttpError);
    assert(handled instanceof HttpError, "expected HttpError");
    expect(handled.developerDetail.body).toBe('{"errors":{"token":"[REDACTED]"}}');
  });
});

describe("MetabaseError contract", () => {
  it("AbortError exposes the documented exit code and category", () => {
    const error = new AbortError();
    expect(error).toBeInstanceOf(MetabaseError);
    expect(error.category).toBe("abort");
    expect(error.exitCode).toBe(130);
    expect(error.developerDetail).toBeNull();
    expect(error.userMessage).toBe("aborted");
  });

  it("ConfigError exposes the documented exit code and category", () => {
    const error = new ConfigError("missing TTY");
    expect(error.category).toBe("config");
    expect(error.exitCode).toBe(2);
    expect(error.userMessage).toBe("missing TTY");
  });
});

describe("formatZodIssue", () => {
  it("formats nested object/array paths with dot and bracket syntax", () => {
    const schema = z.object({
      data: z.array(z.object({ archived: z.boolean() })),
    });
    const result = schema.safeParse({ data: [{ archived: true }, { archived: null }] });
    assert(!result.success, "expected zod failure");
    expect(result.error.issues.map(formatZodIssue)).toEqual([
      "data[1].archived: Invalid input: expected boolean, received null",
    ]);
  });

  it("returns just the message when the issue path is empty (top-level mismatch)", () => {
    const schema = z.string();
    const result = schema.safeParse(42);
    assert(!result.success, "expected zod failure");
    const firstIssue = result.error.issues[0];
    assert(firstIssue !== undefined, "expected at least one issue");
    expect(formatZodIssue(firstIssue)).toBe("Invalid input: expected string, received number");
  });
});

function issueLine(index: number): string {
  return `  /${index}: Invalid input: expected number, received string`;
}

describe("ValidationError userMessage formatting", () => {
  it("appends a JSON-pointer path and the zod issue text for a single issue", () => {
    const schema = z.object({ total: z.number() });
    const result = schema.safeParse({ total: null });
    assert(!result.success, "expected zod failure");
    const error = new ValidationError(
      "api/collection/8/items: value did not match expected schema",
      {
        source: "api/collection/8/items",
        zodIssues: result.error.issues,
      },
    );

    expect(error.message).toBe("api/collection/8/items: value did not match expected schema");
    expect(error.userMessage).toBe(
      "api/collection/8/items: value did not match expected schema\n" +
        "  /total: Invalid input: expected number, received null",
    );
  });

  it("renders one line per issue with array indices in the pointer", () => {
    const schema = z.object({ items: z.array(z.object({ id: z.number() })) });
    const result = schema.safeParse({ items: [{ id: 1 }, { id: "bad" }] });
    assert(!result.success, "expected zod failure");
    const error = new ValidationError("source: value did not match expected schema", {
      source: "source",
      zodIssues: result.error.issues,
    });

    expect(error.userMessage).toBe(
      "source: value did not match expected schema\n" +
        "  /items/1/id: Invalid input: expected number, received string",
    );
  });

  it("escapes JSON Pointer reserved characters in property names", () => {
    const schema = z.object({ "weird/key~with-special": z.string() });
    const result = schema.safeParse({ "weird/key~with-special": 42 });
    assert(!result.success, "expected zod failure");
    const error = new ValidationError("source: value did not match expected schema", {
      source: "source",
      zodIssues: result.error.issues,
    });

    expect(error.userMessage).toBe(
      "source: value did not match expected schema\n" +
        "  /weird~1key~0with-special: Invalid input: expected string, received number",
    );
  });

  it("caps the printed issue list at ten and reports the overflow count", () => {
    const schema = z.array(z.number());
    const result = schema.safeParse(Array.from({ length: 13 }, (_unused, index) => `bad-${index}`));
    assert(!result.success, "expected zod failure");
    const error = new ValidationError("source: value did not match expected schema", {
      source: "source",
      zodIssues: result.error.issues,
    });

    expect(error.userMessage.split("\n")).toEqual([
      "source: value did not match expected schema",
      issueLine(0),
      issueLine(1),
      issueLine(2),
      issueLine(3),
      issueLine(4),
      issueLine(5),
      issueLine(6),
      issueLine(7),
      issueLine(8),
      issueLine(9),
      "  ... and 3 more",
    ]);
  });

  it("falls back to the plain message when developerDetail carries no issues", () => {
    const error = new ValidationError("file: malformed", {
      source: "file",
      zodIssues: [],
    });
    expect(error.userMessage).toBe("file: malformed");
  });
});

function zodIssuesFor<T>(schema: z.ZodType<T>, value: unknown): z.ZodError["issues"] {
  const result = schema.safeParse(value);
  assert(!result.success, "expected zod failure");
  return result.error.issues;
}

function buildResponseShapeError(
  zodIssues: z.ZodError["issues"],
  serverTag: string | null = null,
): ResponseShapeError {
  return new ResponseShapeError({
    method: "GET",
    url: "https://m.example.com/api/session/properties",
    status: 200,
    zodIssues,
    serverTag,
  });
}

describe("ResponseShapeError", () => {
  it("formats the message listing one issue per line under the lead", () => {
    const schema = z.object({ version: z.object({ tag: z.string() }) });
    const error = buildResponseShapeError(zodIssuesFor(schema, { version: {} }));

    expect(error.userMessage).toBe(
      "Metabase returned unexpected response shape:\n" +
        "  version.tag: Invalid input: expected string, received undefined",
    );
    expect(error.category).toBe("response-shape");
    expect(error.exitCode).toBe(1);
  });

  it("caps the listed issues at five and appends an overflow line", () => {
    const schema = z.array(z.number());
    const issues = zodIssuesFor(
      schema,
      Array.from({ length: 8 }, (_unused, index) => `bad-${index}`),
    );
    const error = buildResponseShapeError(issues);

    expect(error.userMessage).toBe(
      "Metabase returned unexpected response shape:\n" +
        "  [0]: Invalid input: expected number, received string\n" +
        "  [1]: Invalid input: expected number, received string\n" +
        "  [2]: Invalid input: expected number, received string\n" +
        "  [3]: Invalid input: expected number, received string\n" +
        "  [4]: Invalid input: expected number, received string\n" +
        "  ... and 3 more",
    );
  });

  it("falls back to just the lead when there are no issues", () => {
    const error = buildResponseShapeError([]);

    expect(error.userMessage).toBe("Metabase returned unexpected response shape");
  });

  it("leads with the server tag when the version is known", () => {
    const schema = z.object({ version: z.object({ tag: z.string() }) });
    const error = buildResponseShapeError(zodIssuesFor(schema, { version: {} }), "v0.58.7");

    expect(error.userMessage).toBe(
      "On Metabase v0.58.7 the response shape was unexpected:\n" +
        "  version.tag: Invalid input: expected string, received undefined",
    );
  });

  it("is passed through unchanged by toMetabaseError", () => {
    const schema = z.object({ id: z.number() });
    const original = buildResponseShapeError(zodIssuesFor(schema, { id: "x" }));

    expect(toMetabaseError(original)).toBe(original);
  });
});
