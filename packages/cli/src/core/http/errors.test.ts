import { describe, expect, it } from "vitest";

import { HttpError } from "./errors";

interface HttpErrorFixtureOverrides {
  status?: number;
  method?: string;
  url?: string;
  responseHeaders?: Headers | Record<string, string>;
  rawBody?: string | null;
  serverTag?: string | null;
  overrideUserMessage?: string;
}

function buildHttpError(overrides: HttpErrorFixtureOverrides = {}): HttpError {
  return new HttpError({
    status: overrides.status ?? 400,
    statusText: "Bad Request",
    method: overrides.method ?? "POST",
    url: overrides.url ?? "https://example.invalid/api/test",
    responseHeaders: overrides.responseHeaders ?? new Headers(),
    rawBody: overrides.rawBody ?? null,
    ...(overrides.serverTag !== undefined && { serverTag: overrides.serverTag }),
    ...(overrides.overrideUserMessage !== undefined && {
      overrideUserMessage: overrides.overrideUserMessage,
    }),
  });
}

function jsonHeaders(): Headers {
  return new Headers({ "content-type": "application/json" });
}

function textHeaders(): Headers {
  return new Headers({ "content-type": "text/plain" });
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
    expect(buildHttpError({ status: 500, rawBody: body }).message).toBe("Metabase returned 500.");
  });

  it("falls back to the status default for malformed JSON bodies", () => {
    expect(buildHttpError({ status: 500, rawBody: "not json at all" }).message).toBe(
      "Metabase returned 500.",
    );
  });

  it("emits an auth message with the host for 401 with no body", () => {
    expect(buildHttpError({ status: 401, rawBody: null }).message).toBe(
      "Invalid or unauthorized API key (host: example.invalid).",
    );
  });

  it("emits an auth message with the host for 403 with no body", () => {
    expect(buildHttpError({ status: 403, rawBody: null }).message).toBe(
      "Invalid or unauthorized API key (host: example.invalid).",
    );
  });

  it("falls back to status defaults for 408 and 429 with no body", () => {
    expect(buildHttpError({ status: 408, rawBody: null }).message).toBe(
      "Metabase timed out responding.",
    );
    expect(buildHttpError({ status: 429, rawBody: null }).message).toBe(
      "Metabase rate-limited the request.",
    );
  });

  it("body-derived messages override status-default messages for auth", () => {
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

describe("HttpError kind classification", () => {
  it("classifies 401 and 403 as auth", () => {
    expect(buildHttpError({ status: 401 }).kind).toBe("auth");
    expect(buildHttpError({ status: 403 }).kind).toBe("auth");
  });

  it("classifies 429 as rate-limit", () => {
    expect(buildHttpError({ status: 429 }).kind).toBe("rate-limit");
  });

  it("classifies 5xx as server-error", () => {
    expect(buildHttpError({ status: 500 }).kind).toBe("server-error");
    expect(buildHttpError({ status: 503 }).kind).toBe("server-error");
  });

  it("classifies 404 with Metabase route-not-found body as route-missing", () => {
    const error = buildHttpError({
      status: 404,
      method: "GET",
      url: "https://example.invalid/api/this-does-not-exist",
      responseHeaders: textHeaders(),
      rawBody: "API endpoint does not exist.",
    });
    expect(error.kind).toBe("route-missing");
  });

  it("classifies 404 with a JSON Not-found envelope as resource-missing", () => {
    const error = buildHttpError({
      status: 404,
      method: "GET",
      url: "https://example.invalid/api/database/9999",
      responseHeaders: jsonHeaders(),
      rawBody: JSON.stringify({ message: "Not found." }),
    });
    expect(error.kind).toBe("resource-missing");
  });

  it("classifies 404 with a text/plain Not-found body as resource-missing (Metabase v0.58)", () => {
    const error = buildHttpError({
      status: 404,
      method: "GET",
      url: "https://example.invalid/api/database/9999",
      responseHeaders: textHeaders(),
      rawBody: "Not found.",
    });
    expect(error.kind).toBe("resource-missing");
    expect(error.message).toBe("Not found: GET /api/database/9999.");
  });

  it("treats a 404 with an empty non-JSON body as route-missing", () => {
    const error = buildHttpError({
      status: 404,
      method: "GET",
      url: "https://example.invalid/api/nope",
      responseHeaders: new Headers(),
      rawBody: "",
    });
    expect(error.kind).toBe("route-missing");
  });
});

describe("HttpError 404 messages", () => {
  it("renders route-missing with the server tag and a real-command hint when the tag is known", () => {
    const error = buildHttpError({
      status: 404,
      method: "GET",
      url: "https://example.invalid/api/this-does-not-exist?q=1",
      responseHeaders: textHeaders(),
      rawBody: "API endpoint does not exist.",
      serverTag: "v0.58.7",
    });
    expect(error.message).toBe(
      "This endpoint is not available on Metabase v0.58.7: GET /api/this-does-not-exist?q=1. " +
        "The command may require a newer Metabase major version. " +
        "Run 'mb auth list' to see this server's version.",
    );
  });

  it("renders route-missing without the version when the tag is unknown", () => {
    const error = buildHttpError({
      status: 404,
      method: "POST",
      url: "https://example.invalid/api/this-does-not-exist",
      responseHeaders: textHeaders(),
      rawBody: "API endpoint does not exist.",
    });
    expect(error.message).toBe(
      "This endpoint is not available on the connected Metabase: POST /api/this-does-not-exist.",
    );
  });

  it("renders resource-missing as 'Not found: METHOD path.' ignoring the body envelope", () => {
    const error = buildHttpError({
      status: 404,
      method: "GET",
      url: "https://example.invalid/api/database/9999",
      responseHeaders: jsonHeaders(),
      rawBody: JSON.stringify({ message: "Not found." }),
      serverTag: "v0.58.7",
    });
    expect(error.message).toBe("Not found: GET /api/database/9999.");
  });

  it("does not append a doctor hint to resource-missing", () => {
    const error = buildHttpError({
      status: 404,
      method: "GET",
      url: "https://example.invalid/api/database/9999",
      responseHeaders: jsonHeaders(),
      rawBody: JSON.stringify({ message: "Not found." }),
      serverTag: "v0.58.7",
    });
    expect(error.message).not.toContain("mb doctor");
  });
});
