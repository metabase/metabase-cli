import { assert, describe, expect, it } from "vitest";

import { ChainedRequestError, ConfigError } from "../errors";

import { chainRequestFailure, HttpError, isHttpNotFound } from "./errors";
import type { RedactionContext } from "./sanitize";

interface HttpErrorFixtureOverrides {
  status?: number;
  method?: string;
  url?: string;
  responseHeaders?: Headers | Record<string, string>;
  rawBody?: string | null;
  serverTag?: string | null;
  overrideUserMessage?: string;
  redactionContext?: RedactionContext;
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
    ...(overrides.redactionContext !== undefined && {
      redactionContext: overrides.redactionContext,
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
  it("uses a text/plain body as the message when there is no envelope", () => {
    const error = buildHttpError({
      responseHeaders: textHeaders(),
      rawBody: "Invalid query: missing or invalid Database ID (:database)\n",
    });
    expect(error.message).toBe("Invalid query: missing or invalid Database ID (:database)");
  });

  it("does not read a non-JSON body of another content type as the message", () => {
    const error = buildHttpError({
      responseHeaders: new Headers({ "content-type": "text/html" }),
      rawBody: "<html><body>Bad Request</body></html>",
    });
    expect(error.message).toBe("Metabase returned 400.");
  });

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

// Bodies Metabase itself pins in its backend tests: `POST /api/card` with a body that misses every
// required key, and `POST /api/api-key` with a blank name.
const CARD_CREATE_400_BODY = JSON.stringify({
  errors: {
    name: "value must be a non-blank string.",
    dataset_query: "Value must be a map.",
    display: "value must be a non-blank string.",
    visualization_settings: "Value must be a map.",
  },
  "specific-errors": {
    name: ["missing required key, received: nil"],
    dataset_query: ["missing required key, received: nil"],
    display: ["missing required key, received: nil"],
    visualization_settings: ['Value must be a map., received: "ABC"'],
  },
});

const API_KEY_BLANK_NAME_400_BODY = JSON.stringify({
  errors: { name: "value must be a non-blank string." },
  "specific-errors": {
    name: ['should be at least 1 character, received: ""', 'non-blank string, received: ""'],
  },
});

describe("HttpError field errors", () => {
  it("exposes the errors map keyed by field", () => {
    expect(buildHttpError({ rawBody: CARD_CREATE_400_BODY }).fieldErrors).toEqual({
      name: "value must be a non-blank string.",
      dataset_query: "Value must be a map.",
      display: "value must be a non-blank string.",
      visualization_settings: "Value must be a map.",
    });
  });

  it("exposes specific-errors as the received-value view of the same fields", () => {
    expect(buildHttpError({ rawBody: CARD_CREATE_400_BODY }).specificFieldErrors).toEqual({
      name: "missing required key, received: nil",
      dataset_query: "missing required key, received: nil",
      display: "missing required key, received: nil",
      visualization_settings: 'Value must be a map., received: "ABC"',
    });
  });

  it("joins the several reasons one field was rejected for", () => {
    expect(buildHttpError({ rawBody: API_KEY_BLANK_NAME_400_BODY }).specificFieldErrors).toEqual({
      name: 'should be at least 1 character, received: ""; non-blank string, received: ""',
    });
  });

  it("keys a rejection nested inside a body object by its dot path", () => {
    const body = JSON.stringify({
      "specific-errors": { prefs: { site_locale: ['valid locale, received: "eng-USA"'] } },
    });
    expect(buildHttpError({ rawBody: body }).specificFieldErrors).toEqual({
      "prefs.site_locale": 'valid locale, received: "eng-USA"',
    });
  });

  it("answers null when the envelope carries no field maps", () => {
    const body = JSON.stringify({ message: "The object has been archived." });
    expect(buildHttpError({ rawBody: body }).fieldErrors).toBeNull();
  });

  it("answers null when the body is not an error envelope at all", () => {
    expect(buildHttpError({ status: 500, rawBody: "not json at all" }).fieldErrors).toBeNull();
  });

  it("keeps the status and the server's message when the errors value is not a field map", () => {
    const error = buildHttpError({
      rawBody: JSON.stringify({ message: "Invalid body", errors: "everything" }),
    });
    expect(error).toBeInstanceOf(HttpError);
    expect(error.fieldErrors).toBeNull();
    expect(error.status).toBe(400);
    expect(error.message).toBe("Invalid body");
  });

  it("drops the map rather than half of it when one field's message is not a string", () => {
    const body = JSON.stringify({ errors: { name: "must be present", limit: 42 } });
    expect(buildHttpError({ rawBody: body }).fieldErrors).toBeNull();
  });

  it("redacts a known secret quoted back inside a field message", () => {
    const error = buildHttpError({
      status: 403,
      rawBody: JSON.stringify({ errors: { api_key: "mb_live_secret is not valid here" } }),
      redactionContext: { knownSecrets: new Set(["mb_live_secret"]) },
    });
    expect(error.fieldErrors).toEqual({ api_key: "[REDACTED] is not valid here" });
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
  it("renders route-missing with the server tag when the tag is known", () => {
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
        "It may require a newer Metabase major version.",
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

describe("isHttpNotFound", () => {
  it("answers true for a 404 HttpError", () => {
    expect(isHttpNotFound(buildHttpError({ status: 404, responseHeaders: jsonHeaders() }))).toBe(
      true,
    );
  });

  it("answers false for a 400 HttpError", () => {
    expect(isHttpNotFound(buildHttpError({ status: 400 }))).toBe(false);
  });

  it("answers false for a 500 HttpError", () => {
    expect(isHttpNotFound(buildHttpError({ status: 500 }))).toBe(false);
  });

  it("answers false for an ENOENT error, which the similarly named file guard owns", () => {
    const enoent = Object.assign(new Error("ENOENT: no such file or directory"), {
      code: "ENOENT",
    });
    expect(isHttpNotFound(enoent)).toBe(false);
  });
});

describe("chainRequestFailure", () => {
  it("keeps a non-HTTP failure's category and retryability behind the new message", () => {
    const cause = new ConfigError("dashcards must be an array");

    const chained = chainRequestFailure(cause, "the follow-up write failed");

    expect(chained).toBeInstanceOf(ChainedRequestError);
    expect(chained.userMessage).toBe("the follow-up write failed");
    expect(chained.category).toBe("config");
  });

  it("rebuilds an HttpError so its status and field errors stay readable", () => {
    const cause = buildHttpError({
      status: 400,
      responseHeaders: jsonHeaders(),
      rawBody: '{"errors":{"name":"value must be a non-blank string."}}',
    });

    const chained = chainRequestFailure(cause, "the follow-up write failed");

    assert(chained instanceof HttpError, "expected HttpError");
    expect(chained.status).toBe(400);
    expect(chained.userMessage).toBe("the follow-up write failed");
    expect(chained.fieldErrors).toEqual({ name: "value must be a non-blank string." });
  });
});
