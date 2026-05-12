import { describe, expect, it } from "vitest";

import { HttpError } from "./errors";

interface HttpErrorFixtureOverrides {
  status?: number;
  rawBody?: string | null;
  overrideUserMessage?: string;
}

function buildHttpError(overrides: HttpErrorFixtureOverrides = {}): HttpError {
  const base = {
    status: overrides.status ?? 400,
    statusText: "Bad Request",
    method: "POST",
    url: "https://example.invalid/api/test",
    responseHeaders: new Headers(),
    rawBody: overrides.rawBody ?? null,
  };
  if (overrides.overrideUserMessage !== undefined) {
    return new HttpError({ ...base, overrideUserMessage: overrides.overrideUserMessage });
  }
  return new HttpError(base);
}

describe("HttpError message extraction", () => {
  it("prefers top-level message over other fields", () => {
    const body = JSON.stringify({
      message: "top-level wins",
      error: "ignored",
      "error-message": "also ignored",
    });
    expect(buildHttpError({ rawBody: body }).message).toBe("top-level wins");
  });

  it("falls back to error when message is absent", () => {
    const body = JSON.stringify({ error: "raw error string" });
    expect(buildHttpError({ rawBody: body }).message).toBe("raw error string");
  });

  it("falls back to error-message when message and error are absent", () => {
    const body = JSON.stringify({ "error-message": "kebab key" });
    expect(buildHttpError({ rawBody: body }).message).toBe("kebab key");
  });

  it("extracts via[0].message for 5xx server-thrown ex-info bodies", () => {
    const body = JSON.stringify({
      via: [{ type: "java.lang.AssertionError", message: "Assert failed: (keyword? driver)" }],
      trace: [["clojure.core$apply", "invokeStatic", "core.clj", 667]],
    });
    expect(buildHttpError({ status: 500, rawBody: body }).message).toBe(
      "Assert failed: (keyword? driver)",
    );
  });

  it("skips via entries without a message and picks the next one", () => {
    const body = JSON.stringify({
      via: [{ type: "java.lang.RuntimeException" }, { message: "second entry has the cause" }],
    });
    expect(buildHttpError({ status: 500, rawBody: body }).message).toBe(
      "second entry has the cause",
    );
  });

  it("formats specific-errors with field-level array messages", () => {
    const body = JSON.stringify({
      "specific-errors": { database: ['should be an integer, received: "My DB"'] },
      errors: { database: "nullable integer" },
    });
    expect(buildHttpError({ rawBody: body }).message).toBe(
      'database: should be an integer, received: "My DB"',
    );
  });

  it("joins multiple array entries on the same field with semicolons", () => {
    const body = JSON.stringify({
      "specific-errors": {
        name: ["should be a string, received: nil", "non-blank string, received: nil"],
      },
    });
    expect(buildHttpError({ rawBody: body }).message).toBe(
      "name: should be a string, received: nil; non-blank string, received: nil",
    );
  });

  it("walks nested specific-errors maps and joins leaves with paths", () => {
    const body = JSON.stringify({
      "specific-errors": { source: { "source-tables": ["missing required key, received: nil"] } },
    });
    expect(buildHttpError({ rawBody: body }).message).toBe(
      "source.source-tables: missing required key, received: nil",
    );
  });

  it("falls back to errors map when specific-errors is absent", () => {
    const body = JSON.stringify({
      errors: { dataset_query: "Value must be a map." },
    });
    expect(buildHttpError({ rawBody: body }).message).toBe("dataset_query: Value must be a map.");
  });

  it("falls back to the status default when the body has no extractable fields", () => {
    const body = JSON.stringify({ unrelated: "data", trace: [] });
    expect(buildHttpError({ status: 500, rawBody: body }).message).toBe("Metabase returned 500");
  });

  it("falls back to the status default for malformed JSON bodies", () => {
    expect(buildHttpError({ status: 500, rawBody: "not json at all" }).message).toBe(
      "Metabase returned 500",
    );
  });

  it("preserves the override message for known status codes", () => {
    expect(buildHttpError({ status: 401, rawBody: null }).message).toBe(
      "Invalid or unauthorized API key",
    );
    expect(buildHttpError({ status: 404, rawBody: null }).message).toBe(
      "Endpoint not found — is this a Metabase instance?",
    );
    expect(buildHttpError({ status: 408, rawBody: null }).message).toBe(
      "Metabase timed out responding",
    );
    expect(buildHttpError({ status: 429, rawBody: null }).message).toBe(
      "Metabase rate-limited the request",
    );
  });

  it("body-derived messages override status-default messages", () => {
    const body = JSON.stringify({ message: "actual problem from server" });
    expect(buildHttpError({ status: 401, rawBody: body }).message).toBe(
      "actual problem from server",
    );
  });

  it("caps long extracted messages with an ellipsis at 500 characters", () => {
    const longMessage = "x".repeat(800);
    const body = JSON.stringify({ message: longMessage });
    expect(buildHttpError({ rawBody: body }).message).toBe("x".repeat(499) + "…");
  });

  it("returns short extracted messages unchanged", () => {
    const body = JSON.stringify({ message: "short" });
    expect(buildHttpError({ rawBody: body }).message).toBe("short");
  });

  it("ignores whitespace-only string leaves when walking specific-errors", () => {
    const body = JSON.stringify({
      "specific-errors": { ignored: "   ", real: ["actual problem"] },
    });
    expect(buildHttpError({ rawBody: body }).message).toBe("real: actual problem");
  });

  it("respects overrideUserMessage and skips body extraction", () => {
    const body = JSON.stringify({ message: "would be extracted otherwise" });
    expect(
      buildHttpError({ rawBody: body, overrideUserMessage: "explicit override" }).message,
    ).toBe("explicit override");
  });
});
