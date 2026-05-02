import { describe, expect, it } from "vitest";
import { z } from "zod";

import { AbortError, ConfigError, MetabaseError, toMetabaseError, UnknownError } from "./errors";
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
    if (zodError.success) {
      throw new Error("expected zod failure");
    }
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
    if (!(handled instanceof HttpError)) {
      throw new Error("expected HttpError");
    }
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
