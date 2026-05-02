import { describe, expect, it } from "vitest";
import { z } from "zod";

import packageJson from "../../../package.json" with { type: "json" };
import { TimeoutError, ValidationError } from "../errors";
import { type ClientCredentials, createClient } from "./client";
import { HttpError } from "./errors";

const CONFIG: ClientCredentials = {
  url: "https://m.example.com",
  apiKey: "mb_test_key_abcdef0123",
};

const PingResponse = z.object({ id: z.number().int(), email: z.string() });

interface FakeFetchHandle {
  fetch: typeof fetch;
  calls: FetchCallRecord[];
}

interface FetchCallRecord {
  url: string;
  method: string;
  headers: Record<string, string>;
}

type ResponseFactory = () => Response | Promise<Response>;
type FetchScript = ReadonlyArray<Response | ResponseFactory | Error>;

function makeFakeFetch(script: FetchScript): FakeFetchHandle {
  const queue = [...script];
  const calls: FetchCallRecord[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({
      url: typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url,
      method: init?.method ?? "GET",
      headers: headersToRecord(init?.headers),
    });
    const next = queue.shift();
    if (next === undefined) {
      throw new Error("fakeFetch: no more responses queued");
    }
    if (next instanceof Error) {
      throw next;
    }
    return typeof next === "function" ? await next() : next;
  };
  return { fetch: fetchImpl, calls };
}

function headersToRecord(init: RequestInit["headers"]): Record<string, string> {
  const result: Record<string, string> = {};
  if (!init) {
    return result;
  }
  if (init instanceof Headers) {
    for (const [key, value] of init.entries()) {
      result[key] = value;
    }
    return result;
  }
  if (Array.isArray(init)) {
    for (const entry of init) {
      const key = entry[0];
      const value = entry[1];
      if (typeof key === "string" && typeof value === "string") {
        result[key] = value;
      }
    }
    return result;
  }
  for (const [key, value] of Object.entries(init)) {
    if (typeof value === "string") {
      result[key] = value;
    }
  }
  return result;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  });
}

const HANGING_FETCH: typeof fetch = (_input, init) =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => {
      reject(new DOMException("Aborted", "AbortError"));
    });
  });

describe("createClient.requestParsed", () => {
  it("returns parsed JSON on a 200 response", async () => {
    const fakeFetch = makeFakeFetch([jsonResponse({ id: 1, email: "a@b.com" })]);
    const client = createClient(CONFIG, { fetchImpl: fakeFetch.fetch });

    const result = await client.requestParsed(PingResponse, "/api/user/current");

    expect(result).toEqual({ id: 1, email: "a@b.com" });
    expect(fakeFetch.calls).toEqual([
      {
        url: "https://m.example.com/api/user/current",
        method: "GET",
        headers: {
          "x-api-key": "mb_test_key_abcdef0123",
          accept: "application/json",
          "user-agent": `metabase-cli/${packageJson.version}`,
        },
      },
    ]);
  });

  it("retries 5xx responses and returns the eventual success body", async () => {
    const fakeFetch = makeFakeFetch([
      new Response("oops", { status: 500 }),
      new Response("oops again", { status: 502 }),
      jsonResponse({ id: 7, email: "u@m.com" }),
    ]);
    const client = createClient(CONFIG, { fetchImpl: fakeFetch.fetch });

    const result = await client.requestParsed(PingResponse, "/api/user/current", { retries: 3 });

    expect(result).toEqual({ id: 7, email: "u@m.com" });
    expect(fakeFetch.calls.length).toBe(3);
  });

  it("throws HttpError when retries are exhausted", async () => {
    const fakeFetch = makeFakeFetch([
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
    const client = createClient(CONFIG, { fetchImpl: fakeFetch.fetch });

    const error = await client
      .requestParsed(PingResponse, "/api/user/current", { retries: 2 })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(HttpError);
    if (!(error instanceof HttpError)) {
      throw new Error("expected HttpError");
    }
    expect(error.status).toBe(500);
    expect(error.userMessage).toBe("server boom");
    expect(fakeFetch.calls.length).toBe(3);
  });

  it("retries on 429 with Retry-After header", async () => {
    const fakeFetch = makeFakeFetch([
      new Response("rate", { status: 429, headers: { "retry-after": "0" } }),
      jsonResponse({ id: 1, email: "a@b.com" }),
    ]);
    const client = createClient(CONFIG, { fetchImpl: fakeFetch.fetch });

    const result = await client.requestParsed(PingResponse, "/api/user/current", { retries: 1 });

    expect(result).toEqual({ id: 1, email: "a@b.com" });
    expect(fakeFetch.calls.length).toBe(2);
  });

  it("retries network failures", async () => {
    const fakeFetch = makeFakeFetch([
      new TypeError("fetch failed"),
      jsonResponse({ id: 2, email: "x@y.com" }),
    ]);
    const client = createClient(CONFIG, { fetchImpl: fakeFetch.fetch });

    const result = await client.requestParsed(PingResponse, "/api/user/current", { retries: 2 });

    expect(result).toEqual({ id: 2, email: "x@y.com" });
    expect(fakeFetch.calls.length).toBe(2);
  });

  it("throws ValidationError when the response does not match the schema", async () => {
    const fakeFetch = makeFakeFetch([jsonResponse({ id: "not-a-number", email: "a@b.com" })]);
    const client = createClient(CONFIG, { fetchImpl: fakeFetch.fetch });

    const error = await client
      .requestParsed(PingResponse, "/api/user/current")
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ValidationError);
    if (!(error instanceof ValidationError)) {
      throw new Error("expected ValidationError");
    }
    expect(error.userMessage).toMatch(/schema/i);
  });

  it("throws HttpError on content-type mismatch with no silent downgrade", async () => {
    const fakeFetch = makeFakeFetch([
      new Response("<html>oops</html>", { status: 200, headers: { "content-type": "text/html" } }),
    ]);
    const client = createClient(CONFIG, { fetchImpl: fakeFetch.fetch });

    const error = await client
      .requestParsed(PingResponse, "/api/user/current")
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(HttpError);
    if (!(error instanceof HttpError)) {
      throw new Error("expected HttpError");
    }
    expect(error.developerDetail.body).toBeNull();
    expect(error.userMessage).toBe("Expected json response but got text/html");
  });

  it("throws HttpError when the response has no content-type header", async () => {
    const fakeFetch = makeFakeFetch([
      () => {
        const response = new Response('{"id":1,"email":"a@b"}', { status: 200 });
        response.headers.delete("content-type");
        return response;
      },
    ]);
    const client = createClient(CONFIG, { fetchImpl: fakeFetch.fetch });

    const error = await client
      .requestParsed(PingResponse, "/api/user/current")
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(HttpError);
    if (!(error instanceof HttpError)) {
      throw new Error("expected HttpError");
    }
    expect(error.userMessage).toBe("Expected json response but got no content-type");
  });

  it("times out a hung request and throws TimeoutError", async () => {
    const client = createClient(CONFIG, { fetchImpl: HANGING_FETCH });

    const error = await client
      .requestParsed(PingResponse, "/api/user/current", { timeoutMs: 25, retries: 0 })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(TimeoutError);
    if (!(error instanceof TimeoutError)) {
      throw new Error("expected TimeoutError");
    }
    expect(error.developerDetail.timeoutMs).toBe(25);
  });
});

describe("createClient idempotency-aware retry", () => {
  it("does not retry POST on 5xx and surfaces the first HttpError", async () => {
    const fakeFetch = makeFakeFetch([
      new Response('{"message":"server boom"}', {
        status: 500,
        headers: { "content-type": "application/json" },
      }),
    ]);
    const client = createClient(CONFIG, { fetchImpl: fakeFetch.fetch });

    const error = await client
      .requestParsed(PingResponse, "/api/transform/run", { method: "POST", retries: 3 })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(HttpError);
    if (!(error instanceof HttpError)) {
      throw new Error("expected HttpError");
    }
    expect(error.status).toBe(500);
    expect(error.userMessage).toBe("server boom");
    expect(fakeFetch.calls.length).toBe(1);
  });

  it("does not retry POST on 429 either — non-idempotent never retries on status", async () => {
    const fakeFetch = makeFakeFetch([
      new Response('{"message":"slow down"}', {
        status: 429,
        headers: { "content-type": "application/json", "retry-after": "0" },
      }),
    ]);
    const client = createClient(CONFIG, { fetchImpl: fakeFetch.fetch });

    const error = await client
      .requestParsed(PingResponse, "/api/card", { method: "POST", retries: 3 })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(HttpError);
    if (!(error instanceof HttpError)) {
      throw new Error("expected HttpError");
    }
    expect(error.status).toBe(429);
    expect(error.userMessage).toBe("slow down");
    expect(fakeFetch.calls.length).toBe(1);
  });

  it("retries POST on network failure", async () => {
    const fakeFetch = makeFakeFetch([
      new TypeError("fetch failed"),
      jsonResponse({ id: 9, email: "ok@m.com" }),
    ]);
    const client = createClient(CONFIG, { fetchImpl: fakeFetch.fetch });

    const result = await client.requestParsed(PingResponse, "/api/card", {
      method: "POST",
      retries: 2,
    });

    expect(result).toEqual({ id: 9, email: "ok@m.com" });
    expect(fakeFetch.calls.length).toBe(2);
  });

  it("retries non-idempotent calls when the caller explicitly opts in via idempotent: true", async () => {
    const fakeFetch = makeFakeFetch([
      new Response("oops", { status: 503 }),
      jsonResponse({ id: 4, email: "p@u.com" }),
    ]);
    const client = createClient(CONFIG, { fetchImpl: fakeFetch.fetch });

    const result = await client.requestParsed(PingResponse, "/api/card", {
      method: "POST",
      idempotent: true,
      retries: 2,
    });

    expect(result).toEqual({ id: 4, email: "p@u.com" });
    expect(fakeFetch.calls.length).toBe(2);
  });

  it("does not retry GET on 5xx when the caller forces idempotent: false", async () => {
    const fakeFetch = makeFakeFetch([
      new Response('{"message":"down"}', {
        status: 503,
        headers: { "content-type": "application/json" },
      }),
    ]);
    const client = createClient(CONFIG, { fetchImpl: fakeFetch.fetch });

    const error = await client
      .requestParsed(PingResponse, "/api/user/current", { idempotent: false, retries: 3 })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(HttpError);
    if (!(error instanceof HttpError)) {
      throw new Error("expected HttpError");
    }
    expect(error.status).toBe(503);
    expect(error.userMessage).toBe("down");
    expect(fakeFetch.calls.length).toBe(1);
  });
});

describe("createClient sanitization", () => {
  it("strips the configured apiKey from error bodies", async () => {
    const apiKey = "configured_api_key_value";
    const fakeFetch = makeFakeFetch([
      new Response(`{"message":"forbidden","echo":"${apiKey}"}`, {
        status: 403,
        headers: { "content-type": "application/json" },
      }),
    ]);
    const client = createClient(
      { url: "https://m.example.com", apiKey },
      { fetchImpl: fakeFetch.fetch },
    );

    const error = await client
      .requestParsed(PingResponse, "/api/user/current", { retries: 0 })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(HttpError);
    if (!(error instanceof HttpError)) {
      throw new Error("expected HttpError");
    }
    expect(error.developerDetail.body).toBe('{"message":"forbidden","echo":"[REDACTED]"}');
  });

  it("redacts secret response headers in HttpError detail", async () => {
    const fakeFetch = makeFakeFetch([
      new Response('{"message":"forbidden"}', {
        status: 403,
        headers: {
          "content-type": "application/json",
          "x-metabase-session": "session-abc",
          "set-cookie": "session=foo",
        },
      }),
    ]);
    const client = createClient(CONFIG, { fetchImpl: fakeFetch.fetch });

    const error = await client
      .requestParsed(PingResponse, "/api/user/current", { retries: 0 })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(HttpError);
    if (!(error instanceof HttpError)) {
      throw new Error("expected HttpError");
    }
    expect(error.developerDetail.responseHeaders).toEqual({
      "content-type": "application/json",
      "x-metabase-session": "[REDACTED]",
      "set-cookie": "[REDACTED]",
    });
  });
});
