import { afterEach, assert, beforeEach, describe, expect, it, vi } from "vitest";

import { createClient } from "@metabase/client/client";
import { ChainedRequestError, ConfigError, NetworkError } from "@metabase/client/errors";
import { HttpError } from "@metabase/client/http/errors";
import type { ClientCredentials } from "@metabase/client/http/transport";
import {
  captureFetch,
  jsonResponse,
  TEST_USER_AGENT,
} from "@metabase/client/testing/fetch-capture";
import { Card } from "@metabase/client/domain/card";

import { preflightDashcardCardReferences, wrapChainedDashboardWriteError } from "./preflight";

const CREDENTIALS: ClientCredentials = {
  url: "https://mb.example.com",
  credential: { kind: "apiKey", apiKey: "mb_wire_test_key" },
};

const JSON_READ_HEADERS = {
  accept: "application/json",
  "user-agent": TEST_USER_AGENT,
  "x-api-key": "mb_wire_test_key",
};

function cardFixture(id: number, archived = false): Card {
  return Card.parse({
    id,
    name: `card-${id}`,
    type: "question",
    display: "table",
    description: null,
    archived,
    query_type: "query",
    database_id: 1,
    table_id: null,
    collection_id: null,
    entity_id: null,
    creator_id: 1,
    dataset_query: { type: "query" },
    visualization_settings: {},
  });
}

function cardRequest(id: number) {
  return {
    url: `https://mb.example.com/api/card/${id}`,
    method: "GET",
    headers: JSON_READ_HEADERS,
    body: null,
  };
}

function clientOver(responses: Array<Response>) {
  const capture = captureFetch(responses);
  const client = createClient(CREDENTIALS, {
    userAgent: TEST_USER_AGENT,
    fetchImpl: capture.fetch,
  });
  return { client, capture };
}

describe("preflightDashcardCardReferences", () => {
  let captured: string[];

  beforeEach(() => {
    captured = [];
    process.stdout.isTTY = false;
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      captured.push(String(chunk));
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns without making any HTTP calls when dashcards is undefined", async () => {
    const { client, capture } = clientOver([]);
    await preflightDashcardCardReferences(client, undefined);
    expect(capture.calls).toEqual([]);
  });

  it("returns without making any HTTP calls when dashcards has no positive card_id", async () => {
    const { client, capture } = clientOver([]);
    await preflightDashcardCardReferences(client, [
      { id: -1, card_id: null },
      { id: -2, card_id: -3 },
    ]);
    expect(capture.calls).toEqual([]);
  });

  it("returns without throwing when all referenced cards exist and are not archived", async () => {
    const { client, capture } = clientOver([
      jsonResponse(cardFixture(42)),
      jsonResponse(cardFixture(17)),
    ]);
    await preflightDashcardCardReferences(client, [
      { id: -1, card_id: 42 },
      { id: -2, card_id: 17 },
    ]);
    expect(capture.calls).toEqual([cardRequest(42), cardRequest(17)]);
    expect(captured).toEqual([]);
  });

  it("deduplicates HTTP calls when the same card_id appears in multiple dashcards", async () => {
    const { client, capture } = clientOver([jsonResponse(cardFixture(42))]);
    await preflightDashcardCardReferences(client, [
      { id: -1, card_id: 42 },
      { id: -2, card_id: 42 },
      { id: -3, card_id: 42 },
    ]);
    expect(capture.calls).toEqual([cardRequest(42)]);
  });

  it("throws ConfigError with the archived card listed under its dashcard path", async () => {
    const { client } = clientOver([jsonResponse(cardFixture(134, true))]);
    const failure = preflightDashcardCardReferences(client, [{ id: -1, card_id: 134 }]);
    await expect(failure).rejects.toBeInstanceOf(ConfigError);
    await expect(failure).rejects.toThrow(
      "dashboard card-reference pre-flight failed: 1 error(s) — fix the dashcard card_id values listed above",
    );
    expect(captured.join("")).toBe(
      `${JSON.stringify({
        ok: false,
        errors: [{ path: "/dashcards/0/card_id", message: "card 134 is archived" }],
      })}\n`,
    );
  });

  it("emits one envelope entry per dashcard reference even when they share an archived card", async () => {
    const { client } = clientOver([jsonResponse(cardFixture(134, true))]);
    const failure = preflightDashcardCardReferences(client, [
      { id: -1, card_id: 134 },
      { id: -2, card_id: 134 },
    ]);
    await expect(failure).rejects.toBeInstanceOf(ConfigError);
    await expect(failure).rejects.toThrow(
      "dashboard card-reference pre-flight failed: 2 error(s) — fix the dashcard card_id values listed above",
    );
    expect(captured.join("")).toBe(
      `${JSON.stringify({
        ok: false,
        errors: [
          { path: "/dashcards/0/card_id", message: "card 134 is archived" },
          { path: "/dashcards/1/card_id", message: "card 134 is archived" },
        ],
      })}\n`,
    );
  });

  it("reports a missing card_id as 'card N not found' when /api/card/:id returns 404", async () => {
    const { client } = clientOver([jsonResponse({ message: "Not found." }, 404)]);
    const failure = preflightDashcardCardReferences(client, [{ id: -1, card_id: 9999 }]);
    await expect(failure).rejects.toBeInstanceOf(ConfigError);
    await expect(failure).rejects.toThrow(
      "dashboard card-reference pre-flight failed: 1 error(s) — fix the dashcard card_id values listed above",
    );
    expect(captured.join("")).toBe(
      `${JSON.stringify({
        ok: false,
        errors: [{ path: "/dashcards/0/card_id", message: "card 9999 not found" }],
      })}\n`,
    );
  });

  it("reports a permission-denied card as not readable with the original message", async () => {
    const { client } = clientOver([
      jsonResponse({ message: "You do not have permissions to do that." }, 403),
    ]);
    const failure = preflightDashcardCardReferences(client, [{ id: -1, card_id: 55 }]);
    await expect(failure).rejects.toBeInstanceOf(ConfigError);
    await expect(failure).rejects.toThrow(
      "dashboard card-reference pre-flight failed: 1 error(s) — fix the dashcard card_id values listed above",
    );
    expect(captured.join("")).toBe(
      `${JSON.stringify({
        ok: false,
        errors: [
          {
            path: "/dashcards/0/card_id",
            message: "card 55 is not readable: You do not have permissions to do that.",
          },
        ],
      })}\n`,
    );
  });

  it("prints no envelope when the failure propagates instead of naming a bad card", async () => {
    const { client } = clientOver([jsonResponse({ message: "API endpoint does not exist." }, 404)]);
    const failure = preflightDashcardCardReferences(client, [{ id: -1, card_id: 1 }]);
    await expect(failure).rejects.toThrow(
      "This endpoint is not available on the connected Metabase: GET /api/card/1.",
    );
    expect(captured).toEqual([]);
  });
});

describe("wrapChainedDashboardWriteError", () => {
  it("returns the original value unchanged for non-MetabaseError inputs", () => {
    const raw = new TypeError("unexpected");
    expect(wrapChainedDashboardWriteError(raw, 7)).toBe(raw);
  });

  it("wraps an HttpError into a new HttpError preserving status + sanitized body but rewriting userMessage", () => {
    const original = new HttpError({
      status: 400,
      statusText: "Bad Request",
      method: "PUT",
      url: "https://example.com/api/dashboard/7",
      responseHeaders: { "content-type": "application/json" },
      rawBody: '{"message":"The object has been archived."}',
    });
    const wrapped = wrapChainedDashboardWriteError(original, 7);
    expect(wrapped).toBeInstanceOf(HttpError);
    assert(wrapped instanceof HttpError, "expected HttpError");
    expect(wrapped.status).toBe(400);
    expect(wrapped.developerDetail.body).toBe('{"message":"The object has been archived."}');
    expect(wrapped.userMessage).toBe(
      "dashboard 7 created but the follow-up update to dashboard 7 failed: The object has been archived.; dashcards not applied",
    );
  });

  it("wraps a NetworkError into a ChainedRequestError carrying category, retryability, and developerDetail", () => {
    const original = new NetworkError("Could not reach Metabase: socket hang up", {
      method: "PUT",
      url: "https://example.com/api/dashboard/9",
      cause: "socket hang up",
    });
    const wrapped = wrapChainedDashboardWriteError(original, 9);
    expect(wrapped).toBeInstanceOf(ChainedRequestError);
    assert(wrapped instanceof ChainedRequestError, "expected ChainedRequestError");
    expect(wrapped.userMessage).toBe(
      "dashboard 9 created but the follow-up update to dashboard 9 failed: Could not reach Metabase: socket hang up; dashcards not applied",
    );
    expect(wrapped.category).toBe("network");
    expect(wrapped.isRetryable).toBe(true);
    expect(wrapped.developerDetail).toEqual({
      method: "PUT",
      url: "https://example.com/api/dashboard/9",
      cause: "socket hang up",
    });
  });
});
