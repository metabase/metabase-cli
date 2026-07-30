import { describe, expect, it } from "vitest";

import { redactBody, redactHeaders, type RedactionContext } from "./sanitize";

describe("redactHeaders", () => {
  it("redacts all sensitive header names case-insensitively", () => {
    expect(
      redactHeaders({
        Authorization: "Bearer abc",
        "X-API-Key": "mb_secret_key_123",
        "x-metabase-session": "session-id",
        Cookie: "session=foo",
        "Set-Cookie": "session=foo",
        "Proxy-Authorization": "Basic abc",
        "X-Custom": "kept",
      }),
    ).toEqual({
      Authorization: "[REDACTED]",
      "X-API-Key": "[REDACTED]",
      "x-metabase-session": "[REDACTED]",
      Cookie: "[REDACTED]",
      "Set-Cookie": "[REDACTED]",
      "Proxy-Authorization": "[REDACTED]",
      "X-Custom": "kept",
    });
  });

  it("accepts a Headers instance and returns plain entries with sensitive values redacted", () => {
    const headers = new Headers();
    headers.set("authorization", "Bearer abc");
    headers.set("content-type", "application/json");
    expect(redactHeaders(headers)).toEqual({
      authorization: "[REDACTED]",
      "content-type": "application/json",
    });
  });
});

describe("redactBody", () => {
  it("replaces every occurrence of each known secret with [REDACTED]", () => {
    const apiKey = "literal_secret_value";
    const ctx: RedactionContext = { knownSecrets: new Set([apiKey]) };
    expect(redactBody(`leaked: ${apiKey} and again ${apiKey}`, ctx)).toBe(
      "leaked: [REDACTED] and again [REDACTED]",
    );
  });

  it("returns the body unchanged when no known secret appears in it", () => {
    const ctx: RedactionContext = { knownSecrets: new Set(["nope"]) };
    expect(redactBody('{"message":"not authenticated"}', ctx)).toBe(
      '{"message":"not authenticated"}',
    );
  });

  it("ignores empty strings in knownSecrets to avoid replacing every position", () => {
    const ctx: RedactionContext = { knownSecrets: new Set(["", "real"]) };
    expect(redactBody("real value here", ctx)).toBe("[REDACTED] value here");
  });
});
