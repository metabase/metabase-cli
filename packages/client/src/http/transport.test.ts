import { setTimeout as delay } from "node:timers/promises";

import { assert, describe, expect, it } from "vitest";
import { z } from "zod";

import type { OAuthCredential } from "../auth/credential";
import { AbortError, ConfigError, NetworkError, ResponseShapeError, TimeoutError } from "../errors";

import {
  type ClientCredentials,
  createTransport,
  type RequestOptions,
  type Transport,
} from "./transport";
import { HttpError } from "./errors";
import { captureFetch, jsonResponse, TEST_USER_AGENT } from "../testing/fetch-capture";

const CONFIG: ClientCredentials = {
  url: "https://m.example.com",
  credential: { kind: "apiKey", apiKey: "mb_test_key_abcdef0123" },
};

const PingResponse = z.object({ id: z.number().int(), email: z.string() });

const HANGING_FETCH: typeof fetch = (_input, init) =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => {
      reject(new DOMException("Aborted", "AbortError"));
    });
  });

function transportFailure(code: string, detail: string): TypeError {
  const failure = new TypeError("fetch failed");
  failure.cause = Object.assign(new Error(detail), { code });
  return failure;
}

// Bun rejects with one error carrying the syscall code itself, where Node nests it under `cause`.
function bunTransportFailure(code: string, detail: string): Error {
  return Object.assign(new Error(detail), { code });
}

describe("createTransport.requestParsed", () => {
  it("returns parsed JSON on a 200 response", async () => {
    const fakeFetch = captureFetch([jsonResponse({ id: 1, email: "a@b.com" })]);
    const client = createTransport(CONFIG, {
      userAgent: TEST_USER_AGENT,
      fetchImpl: fakeFetch.fetch,
    });

    const result = await client.requestParsed(PingResponse, "/api/user/current");

    expect(result).toEqual({ id: 1, email: "a@b.com" });
    expect(fakeFetch.calls).toEqual([
      {
        url: "https://m.example.com/api/user/current",
        method: "GET",
        headers: {
          "x-api-key": "mb_test_key_abcdef0123",
          accept: "application/json",
          "user-agent": TEST_USER_AGENT,
        },
        body: null,
      },
    ]);
  });

  it("retries 5xx responses and returns the eventual success body", async () => {
    const fakeFetch = captureFetch([
      new Response("oops", { status: 500 }),
      new Response("oops again", { status: 502 }),
      jsonResponse({ id: 7, email: "u@m.com" }),
    ]);
    const client = createTransport(CONFIG, {
      userAgent: TEST_USER_AGENT,
      fetchImpl: fakeFetch.fetch,
    });

    const result = await client.requestParsed(PingResponse, "/api/user/current", { retries: 3 });

    expect(result).toEqual({ id: 7, email: "u@m.com" });
    expect(fakeFetch.calls.length).toBe(3);
  });

  it("throws HttpError when retries are exhausted", async () => {
    const fakeFetch = captureFetch([
      new Response('{"message":"server boom"}', {
        status: 500,
        headers: { "content-type": "application/json" },
      }),
      new Response('{"message":"server boom"}', {
        status: 500,
        headers: { "content-type": "application/json" },
      }),
      new Response('{"message":"server boom"}', {
        status: 500,
        headers: { "content-type": "application/json" },
      }),
    ]);
    const client = createTransport(CONFIG, {
      userAgent: TEST_USER_AGENT,
      fetchImpl: fakeFetch.fetch,
    });

    const error = await client
      .requestParsed(PingResponse, "/api/user/current", { retries: 2 })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(HttpError);
    assert(error instanceof HttpError, "expected HttpError");
    expect(error.status).toBe(500);
    expect(error.userMessage).toBe("server boom");
    expect(fakeFetch.calls.length).toBe(3);
  });

  it("retries on 429 with Retry-After header", async () => {
    const fakeFetch = captureFetch([
      new Response("rate", { status: 429, headers: { "retry-after": "0" } }),
      jsonResponse({ id: 1, email: "a@b.com" }),
    ]);
    const client = createTransport(CONFIG, {
      userAgent: TEST_USER_AGENT,
      fetchImpl: fakeFetch.fetch,
    });

    const result = await client.requestParsed(PingResponse, "/api/user/current", { retries: 1 });

    expect(result).toEqual({ id: 1, email: "a@b.com" });
    expect(fakeFetch.calls.length).toBe(2);
  });

  it("retries network failures", async () => {
    const fakeFetch = captureFetch([
      new TypeError("fetch failed"),
      jsonResponse({ id: 2, email: "x@y.com" }),
    ]);
    const client = createTransport(CONFIG, {
      userAgent: TEST_USER_AGENT,
      fetchImpl: fakeFetch.fetch,
    });

    const result = await client.requestParsed(PingResponse, "/api/user/current", { retries: 2 });

    expect(result).toEqual({ id: 2, email: "x@y.com" });
    expect(fakeFetch.calls.length).toBe(2);
  });

  it("maps ECONNREFUSED to an actionable message and carries the code as the cause", async () => {
    const failure = new TypeError("fetch failed");
    failure.cause = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:1"), {
      code: "ECONNREFUSED",
    });
    const fakeFetch = captureFetch([failure]);
    const client = createTransport(CONFIG, {
      userAgent: TEST_USER_AGENT,
      fetchImpl: fakeFetch.fetch,
    });

    const error = await client
      .requestParsed(PingResponse, "/api/user/current", { retries: 0 })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(NetworkError);
    assert(error instanceof NetworkError, "expected NetworkError");
    expect(error.userMessage).toBe(
      "Could not reach Metabase: Connection refused by m.example.com — is Metabase running and is the port correct?",
    );
    expect(error.developerDetail).toEqual({
      method: "GET",
      url: "https://m.example.com/api/user/current",
      cause: "ECONNREFUSED",
    });
  });

  it("maps ENOTFOUND to a host-not-found message", async () => {
    const failure = new TypeError("fetch failed");
    failure.cause = Object.assign(new Error("getaddrinfo ENOTFOUND m.example.com"), {
      code: "ENOTFOUND",
    });
    const fakeFetch = captureFetch([failure]);
    const client = createTransport(CONFIG, {
      userAgent: TEST_USER_AGENT,
      fetchImpl: fakeFetch.fetch,
    });

    const error = await client
      .requestParsed(PingResponse, "/api/user/current", { retries: 0 })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(NetworkError);
    assert(error instanceof NetworkError, "expected NetworkError");
    expect(error.userMessage).toBe(
      "Could not reach Metabase: Host not found: m.example.com — check the URL.",
    );
    expect(error.developerDetail).toEqual({
      method: "GET",
      url: "https://m.example.com/api/user/current",
      cause: "ENOTFOUND",
    });
  });

  it("falls back to the raw fetch message when the cause carries no error code", async () => {
    const fakeFetch = captureFetch([new TypeError("fetch failed")]);
    const client = createTransport(CONFIG, {
      userAgent: TEST_USER_AGENT,
      fetchImpl: fakeFetch.fetch,
    });

    const error = await client
      .requestParsed(PingResponse, "/api/user/current", { retries: 0 })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(NetworkError);
    assert(error instanceof NetworkError, "expected NetworkError");
    expect(error.userMessage).toBe("Could not reach Metabase: fetch failed");
    expect(error.developerDetail).toEqual({
      method: "GET",
      url: "https://m.example.com/api/user/current",
      cause: "fetch failed",
    });
  });

  it("throws ResponseShapeError carrying the request context and the schema's zod issues", async () => {
    const body = { id: "not-a-number", email: "a@b.com" };
    const expectedIssues = PingResponse.safeParse(body).error?.issues;
    assert(expectedIssues !== undefined, "expected zod failure for fixture body");
    const fakeFetch = captureFetch([jsonResponse(body)]);
    const client = createTransport(CONFIG, {
      userAgent: TEST_USER_AGENT,
      fetchImpl: fakeFetch.fetch,
    });

    const error = await client
      .requestParsed(PingResponse, "/api/user/current")
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ResponseShapeError);
    assert(error instanceof ResponseShapeError, "expected ResponseShapeError");
    expect(error.userMessage).toBe(
      "Metabase returned unexpected response shape:\n" +
        "  id: Invalid input: expected number, received string",
    );
    expect(error.developerDetail).toEqual({
      kind: "zod",
      method: "GET",
      url: "https://m.example.com/api/user/current",
      status: 200,
      zodIssues: expectedIssues,
      serverTag: null,
    });
  });

  it("threads getServerTag into ResponseShapeError so the lead names the version", async () => {
    const body = { id: "not-a-number", email: "a@b.com" };
    const expectedIssues = PingResponse.safeParse(body).error?.issues;
    assert(expectedIssues !== undefined, "expected zod failure for fixture body");
    const fakeFetch = captureFetch([jsonResponse(body)]);
    const client = createTransport(CONFIG, {
      userAgent: TEST_USER_AGENT,
      fetchImpl: fakeFetch.fetch,
      getServerTag: async () => "v0.58.7",
    });

    const error = await client
      .requestParsed(PingResponse, "/api/user/current")
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ResponseShapeError);
    assert(error instanceof ResponseShapeError, "expected ResponseShapeError");
    expect(error.developerDetail).toEqual({
      kind: "zod",
      method: "GET",
      url: "https://m.example.com/api/user/current",
      status: 200,
      zodIssues: expectedIssues,
      serverTag: "v0.58.7",
    });
    expect(error.userMessage).toBe(
      "On Metabase v0.58.7 the response shape was unexpected:\n" +
        "  id: Invalid input: expected number, received string",
    );
  });

  it("threads getServerTag into HttpError so route-missing names the version", async () => {
    const fakeFetch = captureFetch([
      new Response("API endpoint does not exist.", {
        status: 404,
        headers: { "content-type": "text/plain" },
      }),
    ]);
    const client = createTransport(CONFIG, {
      userAgent: TEST_USER_AGENT,
      fetchImpl: fakeFetch.fetch,
      getServerTag: async () => "v0.58.7",
    });

    const error = await client
      .requestParsed(PingResponse, "/api/this-does-not-exist", { retries: 0 })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(HttpError);
    assert(error instanceof HttpError, "expected HttpError");
    expect(error.kind).toBe("route-missing");
    expect(error.userMessage).toBe(
      "This endpoint is not available on Metabase v0.58.7: GET /api/this-does-not-exist. " +
        "It may require a newer Metabase major version.",
    );
  });

  it("hands a rejected create back with the rejected fields named", async () => {
    const body = JSON.stringify({
      errors: { name: "value must be a non-blank string." },
      "specific-errors": { name: ["missing required key, received: nil"] },
    });
    const fakeFetch = captureFetch([
      new Response(body, { status: 400, headers: { "content-type": "application/json" } }),
    ]);
    const client = createTransport(CONFIG, {
      userAgent: TEST_USER_AGENT,
      fetchImpl: fakeFetch.fetch,
    });

    const error = await client
      .requestParsed(PingResponse, "/api/card", { method: "POST", body: { display: "table" } })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(HttpError);
    assert(error instanceof HttpError, "expected HttpError");
    expect(error.userMessage).toBe("name: missing required key, received: nil");
    expect(error.fieldErrors).toEqual({ name: "value must be a non-blank string." });
  });

  it("throws HttpError on content-type mismatch with no silent downgrade", async () => {
    const fakeFetch = captureFetch([
      new Response("<html>oops</html>", { status: 200, headers: { "content-type": "text/html" } }),
    ]);
    const client = createTransport(CONFIG, {
      userAgent: TEST_USER_AGENT,
      fetchImpl: fakeFetch.fetch,
    });

    const error = await client
      .requestParsed(PingResponse, "/api/user/current")
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(HttpError);
    assert(error instanceof HttpError, "expected HttpError");
    expect(error.developerDetail.body).toBeNull();
    expect(error.userMessage).toBe("Expected json response but got text/html");
  });

  it("throws HttpError when the response has no content-type header", async () => {
    const fakeFetch = captureFetch([
      () => {
        const response = new Response('{"id":1,"email":"a@b"}', { status: 200 });
        response.headers.delete("content-type");
        return response;
      },
    ]);
    const client = createTransport(CONFIG, {
      userAgent: TEST_USER_AGENT,
      fetchImpl: fakeFetch.fetch,
    });

    const error = await client
      .requestParsed(PingResponse, "/api/user/current")
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(HttpError);
    assert(error instanceof HttpError, "expected HttpError");
    expect(error.userMessage).toBe("Expected json response but got no content-type");
  });

  it("times out a hung request and throws TimeoutError", async () => {
    const client = createTransport(CONFIG, {
      userAgent: TEST_USER_AGENT,
      fetchImpl: HANGING_FETCH,
    });

    const error = await client
      .requestParsed(PingResponse, "/api/user/current", { timeoutMs: 25, retries: 0 })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(TimeoutError);
    assert(error instanceof TimeoutError, "expected TimeoutError");
    expect(error.developerDetail.timeoutMs).toBe(25);
  });
});

describe("createTransport cancellation", () => {
  it("installs no process signal handler, so an embedder keeps its own Ctrl-C semantics", async () => {
    const before = process.listenerCount("SIGINT");
    const fakeFetch = captureFetch([jsonResponse({ id: 1, email: "a@b.com" })]);
    const client = createTransport(CONFIG, {
      userAgent: TEST_USER_AGENT,
      fetchImpl: fakeFetch.fetch,
    });

    await client.requestParsed(PingResponse, "/api/user/current");

    expect(process.listenerCount("SIGINT")).toBe(before);
  });

  it("aborts an in-flight request with the client-wide signal's reason", async () => {
    const controller = new AbortController();
    const client = createTransport(CONFIG, {
      userAgent: TEST_USER_AGENT,
      fetchImpl: HANGING_FETCH,
      signal: controller.signal,
    });
    const reason = new AbortError("interrupted");

    const pending = client
      .requestParsed(PingResponse, "/api/user/current")
      .catch((caught: unknown) => caught);
    controller.abort(reason);

    expect(await pending).toBe(reason);
  });

  it("aborts an in-flight request with the per-request signal's reason", async () => {
    const controller = new AbortController();
    const client = createTransport(CONFIG, {
      userAgent: TEST_USER_AGENT,
      fetchImpl: HANGING_FETCH,
    });
    const reason = new AbortError("caller cancelled");

    const pending = client
      .requestParsed(PingResponse, "/api/user/current", { signal: controller.signal })
      .catch((caught: unknown) => caught);
    controller.abort(reason);

    expect(await pending).toBe(reason);
  });

  it("aborts during the retry backoff instead of sleeping out the schedule", async () => {
    const controller = new AbortController();
    const fakeFetch = captureFetch([new Response("oops", { status: 500 })]);
    const client = createTransport(CONFIG, {
      userAgent: TEST_USER_AGENT,
      fetchImpl: fakeFetch.fetch,
      signal: controller.signal,
    });
    const reason = new AbortError("interrupted");

    const pending = client
      .requestParsed(PingResponse, "/api/user/current", { retries: 3 })
      .catch((caught: unknown) => caught);
    await delay(10);
    controller.abort(reason);

    expect(await pending).toBe(reason);
    expect(fakeFetch.calls.length).toBe(1);
  });
});

describe("createTransport credential encoding", () => {
  it("rejects an api key holding a character above Latin-1 at construction, naming the field", () => {
    expect(() =>
      createTransport(
        { url: "https://m.example.com", credential: { kind: "apiKey", apiKey: "mb_…key" } },
        { userAgent: TEST_USER_AGENT },
      ),
    ).toThrowError(
      new ConfigError(
        'Credential field "apiKey" has a character at index 3 (U+2026) that cannot be sent in an HTTP header. ' +
          "Header values are limited to Latin-1; a smart quote, ellipsis, or dash substituted during copy-paste is the usual cause.",
      ),
    );
  });

  it("rejects an oauth access token holding a character above Latin-1, naming that field instead", () => {
    expect(() =>
      createTransport(
        {
          url: "https://m.example.com",
          credential: {
            kind: "oauth",
            accessToken: "at’x",
            refreshToken: "rt",
            expiresAt: "2099-01-01T00:00:00.000Z",
            clientId: "cid",
          },
        },
        { userAgent: TEST_USER_AGENT },
      ),
    ).toThrowError(
      new ConfigError(
        'Credential field "accessToken" has a character at index 2 (U+2019) that cannot be sent in an HTTP header. ' +
          "Header values are limited to Latin-1; a smart quote, ellipsis, or dash substituted during copy-paste is the usual cause.",
      ),
    );
  });

  it("keeps the credential out of the message, so the error does not undo redaction", () => {
    const apiKey = "mb_secret_material_…";
    let thrown: unknown = null;
    try {
      createTransport(
        { url: "https://m.example.com", credential: { kind: "apiKey", apiKey } },
        { userAgent: TEST_USER_AGENT },
      );
    } catch (error) {
      thrown = error;
    }
    assert(thrown instanceof ConfigError);
    expect(thrown.message).toContain('Credential field "apiKey" has a character at index 19');
    expect(thrown.message).not.toContain("mb_secret_material_");
  });

  it("accepts a key at the top of the Latin-1 range", () => {
    const client = createTransport(
      { url: "https://m.example.com", credential: { kind: "apiKey", apiKey: "mb_ÿ" } },
      { userAgent: TEST_USER_AGENT },
    );
    expect(typeof client.requestParsed).toBe("function");
  });
});

describe("createTransport base URL", () => {
  it("rejects a scheme-less base URL at construction, inside the error taxonomy", () => {
    expect(() =>
      createTransport(
        { url: "metabase.example.com", credential: CONFIG.credential },
        { userAgent: TEST_USER_AGENT },
      ),
    ).toThrowError(new ConfigError("URL must start with http:// or https://"));
  });

  it("trims a trailing slash off the base URL rather than doubling the separator", async () => {
    const fakeFetch = captureFetch([jsonResponse({ id: 1, email: "a@b.com" })]);
    const client = createTransport(
      { url: "https://m.example.com/", credential: CONFIG.credential },
      { userAgent: TEST_USER_AGENT, fetchImpl: fakeFetch.fetch },
    );

    await client.requestParsed(PingResponse, "/api/user/current");

    expect(fakeFetch.calls[0]?.url).toBe("https://m.example.com/api/user/current");
  });
});

describe("createTransport user-agent", () => {
  it("sends the caller's user-agent, not one of its own", async () => {
    const otherCaller = "another-embedder/0.0.1";
    const fakeFetch = captureFetch([jsonResponse({ id: 1, email: "a@b.com" })]);
    const client = createTransport(CONFIG, { userAgent: otherCaller, fetchImpl: fakeFetch.fetch });

    await client.requestParsed(PingResponse, "/api/user/current");

    expect(fakeFetch.calls[0]?.headers["user-agent"]).toBe(otherCaller);
  });
});

describe("createTransport idempotency-aware retry", () => {
  it("does not retry POST on 5xx and surfaces the first HttpError", async () => {
    const fakeFetch = captureFetch([
      new Response('{"message":"server boom"}', {
        status: 500,
        headers: { "content-type": "application/json" },
      }),
    ]);
    const client = createTransport(CONFIG, {
      userAgent: TEST_USER_AGENT,
      fetchImpl: fakeFetch.fetch,
    });

    const error = await client
      .requestParsed(PingResponse, "/api/transform/run", { method: "POST", retries: 3 })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(HttpError);
    assert(error instanceof HttpError, "expected HttpError");
    expect(error.status).toBe(500);
    expect(error.userMessage).toBe("server boom");
    expect(fakeFetch.calls.length).toBe(1);
  });

  it("does not retry POST on 429 either — non-idempotent never retries on status", async () => {
    const fakeFetch = captureFetch([
      new Response('{"message":"slow down"}', {
        status: 429,
        headers: { "content-type": "application/json", "retry-after": "0" },
      }),
    ]);
    const client = createTransport(CONFIG, {
      userAgent: TEST_USER_AGENT,
      fetchImpl: fakeFetch.fetch,
    });

    const error = await client
      .requestParsed(PingResponse, "/api/card", { method: "POST", retries: 3 })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(HttpError);
    assert(error instanceof HttpError, "expected HttpError");
    expect(error.status).toBe(429);
    expect(error.userMessage).toBe("slow down");
    expect(fakeFetch.calls.length).toBe(1);
  });

  it("does not retry POST on network failure — a lost connection cannot prove the write never landed", async () => {
    const fakeFetch = captureFetch([new TypeError("fetch failed")]);
    const client = createTransport(CONFIG, {
      userAgent: TEST_USER_AGENT,
      fetchImpl: fakeFetch.fetch,
    });

    const error = await client
      .requestParsed(PingResponse, "/api/card", { method: "POST", retries: 2 })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(NetworkError);
    assert(error instanceof NetworkError, "expected NetworkError");
    expect(error.userMessage).toBe("Could not reach Metabase: fetch failed");
    expect(fakeFetch.calls.length).toBe(1);
  });

  it("spends the whole budget retrying GET on network failure", async () => {
    const fakeFetch = captureFetch([
      new TypeError("fetch failed"),
      new TypeError("fetch failed"),
      new TypeError("fetch failed"),
    ]);
    const client = createTransport(CONFIG, {
      userAgent: TEST_USER_AGENT,
      fetchImpl: fakeFetch.fetch,
    });

    const error = await client
      .requestParsed(PingResponse, "/api/user/current", { retries: 2 })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(NetworkError);
    assert(error instanceof NetworkError, "expected NetworkError");
    expect(error.userMessage).toBe("Could not reach Metabase: fetch failed");
    expect(fakeFetch.calls.length).toBe(3);
  });

  it("retries POST on network failure when the caller opts in via idempotent: true", async () => {
    const fakeFetch = captureFetch([
      new TypeError("fetch failed"),
      jsonResponse({ id: 9, email: "ok@m.com" }),
    ]);
    const client = createTransport(CONFIG, {
      userAgent: TEST_USER_AGENT,
      fetchImpl: fakeFetch.fetch,
    });

    const result = await client.requestParsed(PingResponse, "/api/card", {
      method: "POST",
      idempotent: true,
      retries: 2,
    });

    expect(result).toEqual({ id: 9, email: "ok@m.com" });
    expect(fakeFetch.calls.length).toBe(2);
  });

  it("retries non-idempotent calls when the caller explicitly opts in via idempotent: true", async () => {
    const fakeFetch = captureFetch([
      new Response("oops", { status: 503 }),
      jsonResponse({ id: 4, email: "p@u.com" }),
    ]);
    const client = createTransport(CONFIG, {
      userAgent: TEST_USER_AGENT,
      fetchImpl: fakeFetch.fetch,
    });

    const result = await client.requestParsed(PingResponse, "/api/card", {
      method: "POST",
      idempotent: true,
      retries: 2,
    });

    expect(result).toEqual({ id: 4, email: "p@u.com" });
    expect(fakeFetch.calls.length).toBe(2);
  });

  it("does not retry GET on 5xx when the caller forces idempotent: false", async () => {
    const fakeFetch = captureFetch([
      new Response('{"message":"down"}', {
        status: 503,
        headers: { "content-type": "application/json" },
      }),
    ]);
    const client = createTransport(CONFIG, {
      userAgent: TEST_USER_AGENT,
      fetchImpl: fakeFetch.fetch,
    });

    const error = await client
      .requestParsed(PingResponse, "/api/user/current", { idempotent: false, retries: 3 })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(HttpError);
    assert(error instanceof HttpError, "expected HttpError");
    expect(error.status).toBe(503);
    expect(error.userMessage).toBe("down");
    expect(fakeFetch.calls.length).toBe(1);
  });
});

describe("createTransport closed-connection retry", () => {
  it("retries a connection closed on a reused socket even when the caller passed retries: 0", async () => {
    const fakeFetch = captureFetch([
      transportFailure("ECONNRESET", "read ECONNRESET"),
      jsonResponse({ id: 3, email: "fresh@m.com" }),
    ]);
    const client = createTransport(CONFIG, {
      userAgent: TEST_USER_AGENT,
      fetchImpl: fakeFetch.fetch,
    });

    const result = await client.requestParsed(PingResponse, "/api/user/current", { retries: 0 });

    expect(result).toEqual({ id: 3, email: "fresh@m.com" });
    expect(fakeFetch.calls.length).toBe(2);
  });

  it("retries a Bun-shaped close, whose code sits on the error rather than on its cause", async () => {
    const fakeFetch = captureFetch([
      bunTransportFailure("ECONNRESET", "The socket connection was closed unexpectedly."),
      jsonResponse({ id: 3, email: "fresh@m.com" }),
    ]);
    const client = createTransport(CONFIG, {
      userAgent: TEST_USER_AGENT,
      fetchImpl: fakeFetch.fetch,
    });

    const result = await client.requestParsed(PingResponse, "/api/user/current", { retries: 0 });

    expect(result).toEqual({ id: 3, email: "fresh@m.com" });
    expect(fakeFetch.calls.length).toBe(2);
  });

  it("hints on a Bun-shaped close instead of echoing its bare socket message", async () => {
    const fakeFetch = captureFetch([
      bunTransportFailure("ECONNRESET", "The socket connection was closed unexpectedly."),
      bunTransportFailure("ECONNRESET", "The socket connection was closed unexpectedly."),
    ]);
    const client = createTransport(CONFIG, {
      userAgent: TEST_USER_AGENT,
      fetchImpl: fakeFetch.fetch,
    });

    const error = await client
      .requestParsed(PingResponse, "/api/user/current", { retries: 0 })
      .catch((caught: unknown) => caught);

    assert(error instanceof NetworkError, "expected NetworkError");
    expect(error.userMessage).toBe(
      "Could not reach Metabase: Connection to m.example.com was reset — the server may have closed it, or http/https may be mismatched.",
    );
  });

  it("takes that extra attempt once only and surfaces the second close as a NetworkError", async () => {
    const fakeFetch = captureFetch([
      transportFailure("ECONNRESET", "read ECONNRESET"),
      transportFailure("ECONNRESET", "read ECONNRESET"),
    ]);
    const client = createTransport(CONFIG, {
      userAgent: TEST_USER_AGENT,
      fetchImpl: fakeFetch.fetch,
    });

    const error = await client
      .requestParsed(PingResponse, "/api/user/current", { retries: 0 })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(NetworkError);
    assert(error instanceof NetworkError, "expected NetworkError");
    expect(error.userMessage).toBe(
      "Could not reach Metabase: Connection to m.example.com was reset — the server may have closed it, or http/https may be mismatched.",
    );
    expect(fakeFetch.calls.length).toBe(2);
  });

  it("denies the extra attempt to a POST, which a closed socket cannot prove never landed", async () => {
    const fakeFetch = captureFetch([transportFailure("ECONNRESET", "read ECONNRESET")]);
    const client = createTransport(CONFIG, {
      userAgent: TEST_USER_AGENT,
      fetchImpl: fakeFetch.fetch,
    });

    const error = await client
      .requestParsed(PingResponse, "/api/card", { method: "POST", retries: 0 })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(NetworkError);
    expect(fakeFetch.calls.length).toBe(1);
  });

  it("classifies undici's UND_ERR_SOCKET as a closed connection and gives it its own hint", async () => {
    const fakeFetch = captureFetch([
      transportFailure("UND_ERR_SOCKET", "other side closed"),
      transportFailure("UND_ERR_SOCKET", "other side closed"),
    ]);
    const client = createTransport(CONFIG, {
      userAgent: TEST_USER_AGENT,
      fetchImpl: fakeFetch.fetch,
    });

    const error = await client
      .requestParsed(PingResponse, "/api/user/current", { retries: 0 })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(NetworkError);
    assert(error instanceof NetworkError, "expected NetworkError");
    expect(error.userMessage).toBe(
      "Could not reach Metabase: Connection to m.example.com was closed by the other side — a pooled connection or a proxy may have dropped it.",
    );
    expect(fakeFetch.calls.length).toBe(2);
  });

  it("classifies EPIPE as a closed connection and gives it its own hint", async () => {
    const fakeFetch = captureFetch([
      transportFailure("EPIPE", "write EPIPE"),
      transportFailure("EPIPE", "write EPIPE"),
    ]);
    const client = createTransport(CONFIG, {
      userAgent: TEST_USER_AGENT,
      fetchImpl: fakeFetch.fetch,
    });

    const error = await client
      .requestParsed(PingResponse, "/api/user/current", { retries: 0 })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(NetworkError);
    assert(error instanceof NetworkError, "expected NetworkError");
    expect(error.userMessage).toBe(
      "Could not reach Metabase: Connection to m.example.com closed while the request was still being written — the server or a proxy dropped it.",
    );
    expect(fakeFetch.calls.length).toBe(2);
  });

  it("does not retry a cancelled request, whatever the network error says", async () => {
    const controller = new AbortController();
    const reason = new AbortError("interrupted");
    const fakeFetch = captureFetch([
      () => {
        controller.abort(reason);
        return Promise.reject(transportFailure("ECONNRESET", "read ECONNRESET"));
      },
    ]);
    const client = createTransport(CONFIG, {
      userAgent: TEST_USER_AGENT,
      fetchImpl: fakeFetch.fetch,
      signal: controller.signal,
    });

    const error = await client
      .requestParsed(PingResponse, "/api/user/current", { retries: 3 })
      .catch((caught: unknown) => caught);

    expect(error).toBe(reason);
    expect(fakeFetch.calls.length).toBe(1);
  });

  it("gives a timeout no extra attempt, since its rejection carries no connection-closed code", async () => {
    let calls = 0;
    const countedHang: typeof fetch = (input, init) => {
      calls += 1;
      return HANGING_FETCH(input, init);
    };
    const client = createTransport(CONFIG, {
      userAgent: TEST_USER_AGENT,
      fetchImpl: countedHang,
    });

    const error = await client
      .requestParsed(PingResponse, "/api/user/current", { timeoutMs: 25, retries: 0 })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(TimeoutError);
    expect(calls).toBe(1);
  });

  it("spends the retry budget on a GET that timed out", async () => {
    let calls = 0;
    const countedHang: typeof fetch = (input, init) => {
      calls += 1;
      return HANGING_FETCH(input, init);
    };
    const client = createTransport(CONFIG, {
      userAgent: TEST_USER_AGENT,
      fetchImpl: countedHang,
    });

    const error = await client
      .requestParsed(PingResponse, "/api/user/current", { timeoutMs: 25, retries: 1 })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(TimeoutError);
    expect(calls).toBe(2);
  });

  it("does not retry a POST that timed out — an elapsed clock cannot prove the write never landed", async () => {
    let calls = 0;
    const countedHang: typeof fetch = (input, init) => {
      calls += 1;
      return HANGING_FETCH(input, init);
    };
    const client = createTransport(CONFIG, {
      userAgent: TEST_USER_AGENT,
      fetchImpl: countedHang,
    });

    const error = await client
      .requestParsed(PingResponse, "/api/card", { method: "POST", timeoutMs: 25, retries: 2 })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(TimeoutError);
    assert(error instanceof TimeoutError, "expected TimeoutError");
    expect(error.developerDetail).toEqual({
      kind: "http",
      method: "POST",
      url: "https://m.example.com/api/card",
      timeoutMs: 25,
    });
    expect(calls).toBe(1);
  });
});

describe("createTransport sanitization", () => {
  it("strips the configured apiKey from error bodies", async () => {
    const apiKey = "configured_api_key_value";
    const fakeFetch = captureFetch([
      new Response(`{"message":"forbidden","echo":"${apiKey}"}`, {
        status: 403,
        headers: { "content-type": "application/json" },
      }),
    ]);
    const client = createTransport(
      { url: "https://m.example.com", credential: { kind: "apiKey", apiKey } },
      { userAgent: TEST_USER_AGENT, fetchImpl: fakeFetch.fetch },
    );

    const error = await client
      .requestParsed(PingResponse, "/api/user/current", { retries: 0 })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(HttpError);
    assert(error instanceof HttpError, "expected HttpError");
    expect(error.developerDetail.body).toBe('{"message":"forbidden","echo":"[REDACTED]"}');
  });

  it("redacts secret response headers in HttpError detail", async () => {
    const fakeFetch = captureFetch([
      new Response('{"message":"forbidden"}', {
        status: 403,
        headers: {
          "content-type": "application/json",
          "x-metabase-session": "session-abc",
          "set-cookie": "session=foo",
        },
      }),
    ]);
    const client = createTransport(CONFIG, {
      userAgent: TEST_USER_AGENT,
      fetchImpl: fakeFetch.fetch,
    });

    const error = await client
      .requestParsed(PingResponse, "/api/user/current", { retries: 0 })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(HttpError);
    assert(error instanceof HttpError, "expected HttpError");
    expect(error.developerDetail.responseHeaders).toEqual({
      "content-type": "application/json",
      "x-metabase-session": "[REDACTED]",
      "set-cookie": "[REDACTED]",
    });
  });
});

describe("createTransport query encoding", () => {
  it("encodes array query values as repeated keys and skips undefined entries", async () => {
    const fakeFetch = captureFetch([jsonResponse({ id: 1, email: "a@b.com" })]);
    const client = createTransport(CONFIG, {
      userAgent: TEST_USER_AGENT,
      fetchImpl: fakeFetch.fetch,
    });

    await client.requestParsed(PingResponse, "/api/search", {
      query: {
        models: ["card", "dashboard"],
        q: "x",
        archived: undefined,
      },
    });

    expect(fakeFetch.calls[0]?.url).toBe(
      "https://m.example.com/api/search?models=card&models=dashboard&q=x",
    );
  });
});

const OAUTH: OAuthCredential = {
  kind: "oauth",
  accessToken: "acc-1",
  refreshToken: "ref-1",
  expiresAt: "2026-06-08T13:00:00.000Z",
  clientId: "c1",
};

function unauthorizedResponse(): Response {
  return new Response('{"error":"unauthorized"}', {
    status: 401,
    headers: { "content-type": "application/json" },
  });
}

describe("createTransport OAuth bearer auth", () => {
  it("sends an Authorization Bearer header and no x-api-key", async () => {
    const fakeFetch = captureFetch([jsonResponse({ id: 1, email: "a@b.c" })]);
    const client = createTransport(
      { url: "https://m.example.com", credential: OAUTH },
      { userAgent: TEST_USER_AGENT, fetchImpl: fakeFetch.fetch },
    );
    await client.requestParsed(PingResponse, "/api/user/current");
    expect(fakeFetch.calls[0]?.headers["authorization"]).toBe("Bearer acc-1");
    expect(fakeFetch.calls[0]?.headers["x-api-key"]).toBeUndefined();
  });

  it("refreshes on 401 and replays the request with the new access token", async () => {
    const fakeFetch = captureFetch([
      unauthorizedResponse(),
      jsonResponse({ id: 1, email: "a@b.c" }),
    ]);
    const refreshed: OAuthCredential = { ...OAUTH, accessToken: "acc-2", refreshToken: "ref-2" };
    let refreshCalls = 0;
    const client = createTransport(
      { url: "https://m.example.com", credential: OAUTH },
      {
        userAgent: TEST_USER_AGENT,
        fetchImpl: fakeFetch.fetch,
        refreshCredential: async () => {
          refreshCalls += 1;
          return refreshed;
        },
      },
    );
    const result = await client.requestParsed(PingResponse, "/api/user/current", { retries: 0 });
    expect(result).toEqual({ id: 1, email: "a@b.c" });
    expect(refreshCalls).toBe(1);
    expect(fakeFetch.calls[0]?.headers["authorization"]).toBe("Bearer acc-1");
    expect(fakeFetch.calls[1]?.headers["authorization"]).toBe("Bearer acc-2");
  });

  it("gives up after a single refresh when the replay still 401s", async () => {
    const fakeFetch = captureFetch([unauthorizedResponse(), unauthorizedResponse()]);
    let refreshCalls = 0;
    const client = createTransport(
      { url: "https://m.example.com", credential: OAUTH },
      {
        userAgent: TEST_USER_AGENT,
        fetchImpl: fakeFetch.fetch,
        refreshCredential: async () => {
          refreshCalls += 1;
          return { ...OAUTH, accessToken: "acc-2" };
        },
      },
    );
    const error = await client
      .requestParsed(PingResponse, "/api/user/current", { retries: 0 })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(HttpError);
    assert(error instanceof HttpError, "expected HttpError");
    expect(error.status).toBe(401);
    expect(refreshCalls).toBe(1);
    expect(fakeFetch.calls).toHaveLength(2);
  });

  it("shares a single refresh across concurrent 401s", async () => {
    const fakeFetch = captureFetch([
      unauthorizedResponse(),
      unauthorizedResponse(),
      jsonResponse({ id: 1, email: "a@b.c" }),
      jsonResponse({ id: 1, email: "a@b.c" }),
    ]);
    let refreshCalls = 0;
    const client = createTransport(
      { url: "https://m.example.com", credential: OAUTH },
      {
        userAgent: TEST_USER_AGENT,
        fetchImpl: fakeFetch.fetch,
        refreshCredential: async () => {
          refreshCalls += 1;
          // Yield a macrotask so both 401 handlers (pure microtask chains) join this refresh
          // before it settles — the deterministic worst case for a duplicate-refresh bug.
          await delay(0);
          return { ...OAUTH, accessToken: "acc-2" };
        },
      },
    );
    const results = await Promise.all([
      client.requestParsed(PingResponse, "/api/user/current", { retries: 0 }),
      client.requestParsed(PingResponse, "/api/user/current", { retries: 0 }),
    ]);
    expect(results).toEqual([
      { id: 1, email: "a@b.c" },
      { id: 1, email: "a@b.c" },
    ]);
    expect(refreshCalls).toBe(1);
    expect(fakeFetch.calls[2]?.headers["authorization"]).toBe("Bearer acc-2");
    expect(fakeFetch.calls[3]?.headers["authorization"]).toBe("Bearer acc-2");
  });

  it("refreshes again on a later request when the token expires a second time", async () => {
    const fakeFetch = captureFetch([
      unauthorizedResponse(),
      jsonResponse({ id: 1, email: "a@b.c" }),
      unauthorizedResponse(),
      jsonResponse({ id: 1, email: "a@b.c" }),
    ]);
    let refreshCalls = 0;
    const client = createTransport(
      { url: "https://m.example.com", credential: OAUTH },
      {
        userAgent: TEST_USER_AGENT,
        fetchImpl: fakeFetch.fetch,
        refreshCredential: async () => {
          refreshCalls += 1;
          return { ...OAUTH, accessToken: `acc-${refreshCalls + 1}` };
        },
      },
    );
    await client.requestParsed(PingResponse, "/api/user/current", { retries: 0 });
    await client.requestParsed(PingResponse, "/api/user/current", { retries: 0 });
    // Each expiry event gets its own refresh — no per-client "refresh only once" latch.
    expect(refreshCalls).toBe(2);
  });

  it("does not refresh an API key credential on 401", async () => {
    const fakeFetch = captureFetch([unauthorizedResponse()]);
    let refreshCalls = 0;
    const client = createTransport(
      { url: "https://m.example.com", credential: { kind: "apiKey", apiKey: "k" } },
      {
        userAgent: TEST_USER_AGENT,
        fetchImpl: fakeFetch.fetch,
        refreshCredential: async () => {
          refreshCalls += 1;
          return null;
        },
      },
    );
    await client
      .requestParsed(PingResponse, "/api/user/current", { retries: 0 })
      .catch(() => undefined);
    expect(refreshCalls).toBe(0);
    expect(fakeFetch.calls).toHaveLength(1);
  });

  it("redacts both OAuth tokens from error bodies", async () => {
    const fakeFetch = captureFetch([
      new Response('{"echo":"acc-1 and ref-1"}', {
        status: 403,
        headers: { "content-type": "application/json" },
      }),
    ]);
    const client = createTransport(
      { url: "https://m.example.com", credential: OAUTH },
      { userAgent: TEST_USER_AGENT, fetchImpl: fakeFetch.fetch },
    );
    const error = await client
      .requestParsed(PingResponse, "/api/user/current", { retries: 0 })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(HttpError);
    assert(error instanceof HttpError, "expected HttpError");
    expect(error.developerDetail.body).toBe('{"echo":"[REDACTED] and [REDACTED]"}');
  });
});

describe("createTransport subpath base URLs", () => {
  it("joins request paths under a base URL that carries a subpath", async () => {
    const fakeFetch = captureFetch([jsonResponse({ id: 1, email: "a@b.c" })]);
    const client = createTransport(
      { url: "https://my.org.com/metabase", credential: { kind: "apiKey", apiKey: "k" } },
      { userAgent: TEST_USER_AGENT, fetchImpl: fakeFetch.fetch },
    );
    await client.requestParsed(PingResponse, "/api/user/current");
    expect(fakeFetch.calls[0]?.url).toBe("https://my.org.com/metabase/api/user/current");
  });
});

// The shape every resource method takes: the endpoint and its verb belong to the method, and the
// caller's options are forwarded whole.
async function createCard(
  client: Transport,
  options: RequestOptions,
): Promise<z.infer<typeof PingResponse>> {
  return await client.requestParsed(PingResponse, "/api/card", { method: "POST", ...options });
}

describe("the caller-facing RequestOptions", () => {
  it("cannot express the wire fields a resource method decides for itself", () => {
    const hidesMethod: "method" extends keyof RequestOptions ? never : true = true;
    const hidesQuery: "query" extends keyof RequestOptions ? never : true = true;
    const hidesBody: "body" extends keyof RequestOptions ? never : true = true;
    const hidesContentType: "expectContentType" extends keyof RequestOptions ? never : true = true;
    expect([hidesMethod, hidesQuery, hidesBody, hidesContentType]).toEqual([
      true,
      true,
      true,
      true,
    ]);
  });

  it("carries idempotent through, so a caller can opt a write into a resend", async () => {
    const fakeFetch = captureFetch([
      new TypeError("fetch failed"),
      jsonResponse({ id: 9, email: "ok@m.com" }),
    ]);
    const client = createTransport(CONFIG, {
      userAgent: TEST_USER_AGENT,
      fetchImpl: fakeFetch.fetch,
    });

    const result = await createCard(client, { idempotent: true, retries: 2 });

    expect(result).toEqual({ id: 9, email: "ok@m.com" });
    expect(fakeFetch.calls.length).toBe(2);
  });
});
