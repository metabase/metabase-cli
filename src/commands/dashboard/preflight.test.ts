import { afterEach, assert, beforeEach, describe, expect, it, vi } from "vitest";

import { ChainedRequestError, ConfigError, NetworkError } from "../../core/errors";
import { createFakeClient, type FakeClientCall } from "../../core/http/fake-client";
import { HttpError } from "../../core/http/errors";
import { Card } from "../../domain/card";

import {
  collectDashcardCardReferences,
  preflightDashcardCardReferences,
  wrapChainedDashboardWriteError,
} from "./preflight";

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
    dataset_query: {},
    visualization_settings: {},
  });
}

function paths(calls: ReadonlyArray<FakeClientCall>): string[] {
  return calls.map((call) => call.path);
}

describe("collectDashcardCardReferences", () => {
  it("returns an empty array when dashcards is undefined", () => {
    expect(collectDashcardCardReferences(undefined)).toEqual([]);
  });

  it("returns an empty array when dashcards is empty", () => {
    expect(collectDashcardCardReferences([])).toEqual([]);
  });

  it("collects positive card_ids with JSON-pointer paths preserving index order", () => {
    const dashcards = [
      { id: -1, card_id: 42, row: 0, col: 0 },
      { id: -2, card_id: 17, row: 0, col: 1 },
      { id: -3, card_id: 42, row: 1, col: 0 },
    ];
    expect(collectDashcardCardReferences(dashcards)).toEqual([
      { cardId: 42, path: "/dashcards/0/card_id" },
      { cardId: 17, path: "/dashcards/1/card_id" },
      { cardId: 42, path: "/dashcards/2/card_id" },
    ]);
  });

  it("skips null, negative, zero, and missing card_id entries", () => {
    const dashcards = [
      { id: -1, card_id: null, row: 0, col: 0 },
      { id: -2, card_id: -5, row: 0, col: 1 },
      { id: -3, card_id: 0, row: 1, col: 0 },
      { id: -4, row: 1, col: 1 },
    ];
    expect(collectDashcardCardReferences(dashcards)).toEqual([]);
  });

  it("skips malformed entries silently so the server stays the authority on shape", () => {
    const dashcards = [
      { id: -1, card_id: 99 },
      "not an object",
      42,
      null,
      { id: -2, card_id: "not a number" },
      { id: -3, card_id: 7 },
    ];
    expect(collectDashcardCardReferences(dashcards)).toEqual([
      { cardId: 99, path: "/dashcards/0/card_id" },
      { cardId: 7, path: "/dashcards/5/card_id" },
    ]);
  });
});

describe("preflightDashcardCardReferences", () => {
  let captured: string[];

  beforeEach(() => {
    captured = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      captured.push(String(chunk));
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns without making any HTTP calls when dashcards is undefined", async () => {
    const { client, calls } = createFakeClient();
    await preflightDashcardCardReferences(client, undefined);
    expect(calls).toEqual([]);
  });

  it("returns without making any HTTP calls when dashcards has no positive card_id", async () => {
    const { client, calls } = createFakeClient();
    await preflightDashcardCardReferences(client, [
      { id: -1, card_id: null },
      { id: -2, card_id: -3 },
    ]);
    expect(calls).toEqual([]);
  });

  it("returns without throwing when all referenced cards exist and are not archived", async () => {
    const { client, calls } = createFakeClient({
      responses: new Map([
        ["/api/card/42", cardFixture(42)],
        ["/api/card/17", cardFixture(17)],
      ]),
    });
    await preflightDashcardCardReferences(client, [
      { id: -1, card_id: 42 },
      { id: -2, card_id: 17 },
    ]);
    expect(paths(calls).toSorted()).toEqual(["/api/card/17", "/api/card/42"]);
    expect(captured).toEqual([]);
  });

  it("deduplicates HTTP calls when the same card_id appears in multiple dashcards", async () => {
    const { client, calls } = createFakeClient({
      responses: new Map([["/api/card/42", cardFixture(42)]]),
    });
    await preflightDashcardCardReferences(client, [
      { id: -1, card_id: 42 },
      { id: -2, card_id: 42 },
      { id: -3, card_id: 42 },
    ]);
    expect(paths(calls)).toEqual(["/api/card/42"]);
  });

  it("throws ConfigError with the archived card listed under its dashcard path", async () => {
    const { client } = createFakeClient({
      responses: new Map([["/api/card/134", cardFixture(134, true)]]),
    });
    const failure = preflightDashcardCardReferences(client, [{ id: -1, card_id: 134 }]);
    await expect(failure).rejects.toBeInstanceOf(ConfigError);
    await expect(failure).rejects.toThrow(
      "dashboard card-reference pre-flight failed: 1 error(s) — fix the dashcard card_id values listed above",
    );
    expect(captured.join("")).toBe(
      `${JSON.stringify(
        { ok: false, errors: [{ path: "/dashcards/0/card_id", message: "card 134 is archived" }] },
        null,
        2,
      )}\n`,
    );
  });

  it("emits one envelope entry per dashcard reference even when they share an archived card", async () => {
    const { client } = createFakeClient({
      responses: new Map([["/api/card/134", cardFixture(134, true)]]),
    });
    const failure = preflightDashcardCardReferences(client, [
      { id: -1, card_id: 134 },
      { id: -2, card_id: 134 },
    ]);
    await expect(failure).rejects.toBeInstanceOf(ConfigError);
    await expect(failure).rejects.toThrow(
      "dashboard card-reference pre-flight failed: 2 error(s) — fix the dashcard card_id values listed above",
    );
    expect(captured.join("")).toBe(
      `${JSON.stringify(
        {
          ok: false,
          errors: [
            { path: "/dashcards/0/card_id", message: "card 134 is archived" },
            { path: "/dashcards/1/card_id", message: "card 134 is archived" },
          ],
        },
        null,
        2,
      )}\n`,
    );
  });

  it("reports a missing card_id as 'card N not found' when /api/card/:id returns 404", async () => {
    const notFound = new HttpError({
      status: 404,
      statusText: "Not Found",
      method: "GET",
      url: "https://example.com/api/card/9999",
      responseHeaders: { "content-type": "application/json" },
      rawBody: '{"message":"Not found"}',
    });
    const { client } = createFakeClient({
      errors: new Map([["/api/card/9999", notFound]]),
    });
    const failure = preflightDashcardCardReferences(client, [{ id: -1, card_id: 9999 }]);
    await expect(failure).rejects.toBeInstanceOf(ConfigError);
    await expect(failure).rejects.toThrow(
      "dashboard card-reference pre-flight failed: 1 error(s) — fix the dashcard card_id values listed above",
    );
    expect(captured.join("")).toBe(
      `${JSON.stringify(
        { ok: false, errors: [{ path: "/dashcards/0/card_id", message: "card 9999 not found" }] },
        null,
        2,
      )}\n`,
    );
  });

  it("reports a permission-denied card as not readable with the original message", async () => {
    const forbidden = new HttpError({
      status: 403,
      statusText: "Forbidden",
      method: "GET",
      url: "https://example.com/api/card/55",
      responseHeaders: { "content-type": "application/json" },
      rawBody: '{"message":"You do not have permissions to do that."}',
    });
    const { client } = createFakeClient({
      errors: new Map([["/api/card/55", forbidden]]),
    });
    const failure = preflightDashcardCardReferences(client, [{ id: -1, card_id: 55 }]);
    await expect(failure).rejects.toBeInstanceOf(ConfigError);
    await expect(failure).rejects.toThrow(
      "dashboard card-reference pre-flight failed: 1 error(s) — fix the dashcard card_id values listed above",
    );
    expect(captured.join("")).toBe(
      `${JSON.stringify(
        {
          ok: false,
          errors: [
            {
              path: "/dashcards/0/card_id",
              message: "card 55 is not readable: You do not have permissions to do that.",
            },
          ],
        },
        null,
        2,
      )}\n`,
    );
  });

  it("propagates non-HTTP errors so the user sees a 5xx / network failure verbatim", async () => {
    const network = new NetworkError("Could not reach Metabase: connect ECONNREFUSED", {
      method: "GET",
      url: "https://example.com/api/card/1",
      cause: "connect ECONNREFUSED",
    });
    const { client } = createFakeClient({
      errors: new Map([["/api/card/1", network]]),
    });
    await expect(preflightDashcardCardReferences(client, [{ id: -1, card_id: 1 }])).rejects.toBe(
      network,
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
      "dashboard 7 created but follow-up PUT /api/dashboard/7 failed: The object has been archived.; dashcards not applied",
    );
    expect(wrapped.exitCode).toBe(1);
  });

  it("wraps a NetworkError into a ChainedRequestError carrying category, exitCode, and developerDetail", () => {
    const original = new NetworkError("Could not reach Metabase: socket hang up", {
      method: "PUT",
      url: "https://example.com/api/dashboard/9",
      cause: "socket hang up",
    });
    const wrapped = wrapChainedDashboardWriteError(original, 9);
    expect(wrapped).toBeInstanceOf(ChainedRequestError);
    assert(wrapped instanceof ChainedRequestError, "expected ChainedRequestError");
    expect(wrapped.userMessage).toBe(
      "dashboard 9 created but follow-up PUT /api/dashboard/9 failed: Could not reach Metabase: socket hang up; dashcards not applied",
    );
    expect(wrapped.category).toBe("network");
    expect(wrapped.exitCode).toBe(1);
    expect(wrapped.isRetryable).toBe(true);
    expect(wrapped.developerDetail).toEqual({
      method: "PUT",
      url: "https://example.com/api/dashboard/9",
      cause: "socket hang up",
    });
  });
});
