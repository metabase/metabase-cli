import { assert, describe, expect, it } from "vitest";
import { z } from "zod";

import { type ClientCredentials, createClient } from "../core/http/client";
import { collectPaginated, paginate } from "./paginate";

const CONFIG: ClientCredentials = {
  url: "https://m.example.com",
  apiKey: "mb_test_key",
};

const Card = z.object({ id: z.number().int(), name: z.string() });

interface FetchCallRecord {
  url: string;
  method: string;
}

interface FakeFetchHandle {
  fetch: typeof fetch;
  calls: FetchCallRecord[];
}

interface FetchScriptResponse {
  body: unknown;
}

function makeFakeFetch(script: FetchScriptResponse[]): FakeFetchHandle {
  const queue = [...script];
  const calls: FetchCallRecord[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, method: init?.method ?? "GET" });
    const next = queue.shift();
    assert(next !== undefined, "fakeFetch: no more responses queued");
    return new Response(JSON.stringify(next.body), {
      headers: { "content-type": "application/json" },
    });
  };
  return { fetch: fetchImpl, calls };
}

function urlOf(call: FetchCallRecord): URL {
  return new URL(call.url);
}

function makeItems(count: number): Array<z.infer<typeof Card>> {
  return Array.from({ length: count }, (_, index) => ({ id: index, name: `card-${index}` }));
}

function pageOf(call: FetchCallRecord): { limit: string | null; offset: string | null } {
  const params = urlOf(call).searchParams;
  return { limit: params.get("limit"), offset: params.get("offset") };
}

describe("paginate", () => {
  it("yields items from a single full page and stops when the page comes back smaller", async () => {
    const handle = makeFakeFetch([
      {
        body: {
          data: [
            { id: 1, name: "a" },
            { id: 2, name: "b" },
          ],
          total: 2,
        },
      },
    ]);
    const client = createClient(CONFIG, { fetchImpl: handle.fetch });

    const items = await collectPaginated(client, "/api/card", Card, { pageSize: 50 });

    expect(items).toEqual([
      { id: 1, name: "a" },
      { id: 2, name: "b" },
    ]);
    expect(handle.calls.map(pageOf)).toEqual([{ limit: "50", offset: "0" }]);
  });

  it("walks multiple pages until total is reached", async () => {
    const handle = makeFakeFetch([
      {
        body: {
          data: [
            { id: 1, name: "a" },
            { id: 2, name: "b" },
          ],
          total: 5,
        },
      },
      {
        body: {
          data: [
            { id: 3, name: "c" },
            { id: 4, name: "d" },
          ],
          total: 5,
        },
      },
      { body: { data: [{ id: 5, name: "e" }], total: 5 } },
    ]);
    const client = createClient(CONFIG, { fetchImpl: handle.fetch });

    const items = await collectPaginated(client, "/api/card", Card, { pageSize: 2 });

    expect(items).toEqual([
      { id: 1, name: "a" },
      { id: 2, name: "b" },
      { id: 3, name: "c" },
      { id: 4, name: "d" },
      { id: 5, name: "e" },
    ]);
    expect(handle.calls.map(pageOf)).toEqual([
      { limit: "2", offset: "0" },
      { limit: "2", offset: "2" },
      { limit: "2", offset: "4" },
    ]);
  });

  it("stops before fetching another page when max cap is reached mid-page", async () => {
    const handle = makeFakeFetch([
      {
        body: {
          data: [
            { id: 1, name: "a" },
            { id: 2, name: "b" },
          ],
          total: 100,
        },
      },
    ]);
    const client = createClient(CONFIG, { fetchImpl: handle.fetch });

    const items: Array<z.infer<typeof Card>> = [];
    for await (const item of paginate(client, "/api/card", Card, { pageSize: 2, max: 1 })) {
      items.push(item);
    }

    expect(items).toEqual([{ id: 1, name: "a" }]);
    expect(handle.calls).toHaveLength(1);
  });

  it("requests at most `max` items in the final page", async () => {
    const handle = makeFakeFetch([
      {
        body: {
          data: [
            { id: 1, name: "a" },
            { id: 2, name: "b" },
          ],
          total: 100,
        },
      },
      { body: { data: [{ id: 3, name: "c" }], total: 100 } },
    ]);
    const client = createClient(CONFIG, { fetchImpl: handle.fetch });

    await collectPaginated(client, "/api/card", Card, { pageSize: 2, max: 3 });

    expect(handle.calls.map(pageOf)).toEqual([
      { limit: "2", offset: "0" },
      { limit: "1", offset: "2" },
    ]);
  });

  it("forwards extra query params to every page request", async () => {
    const handle = makeFakeFetch([
      { body: { data: [{ id: 1, name: "a" }], total: 2 } },
      { body: { data: [{ id: 2, name: "b" }], total: 2 } },
    ]);
    const client = createClient(CONFIG, { fetchImpl: handle.fetch });

    await collectPaginated(client, "/api/search", Card, {
      pageSize: 1,
      query: { q: "hello", archived: false },
    });

    for (const call of handle.calls) {
      const params = urlOf(call).searchParams;
      expect(params.get("q")).toBe("hello");
      expect(params.get("archived")).toBe("false");
    }
  });

  it("stops when the server returns a short page even without total", async () => {
    const handle = makeFakeFetch([{ body: { data: [{ id: 1, name: "a" }] } }]);
    const client = createClient(CONFIG, { fetchImpl: handle.fetch });

    const items = await collectPaginated(client, "/api/card", Card, { pageSize: 50 });

    expect(items).toEqual([{ id: 1, name: "a" }]);
    expect(handle.calls).toHaveLength(1);
  });

  it("rejects pages whose items fail schema validation", async () => {
    const handle = makeFakeFetch([{ body: { data: [{ id: "not-a-number", name: "x" }] } }]);
    const client = createClient(CONFIG, { fetchImpl: handle.fetch });

    const error = await collectPaginated(client, "/api/card", Card).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(Error);
  });

  it("preserves passthrough fields in the envelope without affecting yielded items", async () => {
    const handle = makeFakeFetch([
      { body: { data: [{ id: 1, name: "a" }], total: 1, models: ["card"] } },
    ]);
    const client = createClient(CONFIG, { fetchImpl: handle.fetch });

    const items = await collectPaginated(client, "/api/search", Card);
    expect(items).toEqual([{ id: 1, name: "a" }]);
  });

  it("accepts total: null on an empty page without falling over (collection-items shape)", async () => {
    const handle = makeFakeFetch([{ body: { data: [], total: null, models: ["card"] } }]);
    const client = createClient(CONFIG, { fetchImpl: handle.fetch });

    const items = await collectPaginated(client, "/api/collection/8/items", Card, { pageSize: 50 });

    expect(items).toEqual([]);
    expect(handle.calls).toHaveLength(1);
  });

  it("treats total: null as unknown total and continues paginating until a short page", async () => {
    const handle = makeFakeFetch([
      { body: { data: [{ id: 1, name: "a" }], total: null } },
      { body: { data: [{ id: 2, name: "b" }], total: null } },
      { body: { data: [], total: null } },
    ]);
    const client = createClient(CONFIG, { fetchImpl: handle.fetch });

    const items = await collectPaginated(client, "/api/card", Card, { pageSize: 1 });

    expect(items).toEqual([
      { id: 1, name: "a" },
      { id: 2, name: "b" },
    ]);
    expect(handle.calls).toHaveLength(3);
  });
});

describe("paginate edge-case grid", () => {
  function buildPagedFetch(items: Array<z.infer<typeof Card>>): FakeFetchHandle {
    const calls: FetchCallRecord[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      calls.push({ url, method: init?.method ?? "GET" });
      const params = new URL(url).searchParams;
      const limitParam = params.get("limit");
      const offsetParam = params.get("offset");
      assert(
        limitParam !== null && offsetParam !== null,
        "paginate must always send both limit and offset",
      );
      const slice = items.slice(Number(offsetParam), Number(offsetParam) + Number(limitParam));
      return new Response(JSON.stringify({ data: slice, total: items.length }), {
        headers: { "content-type": "application/json" },
      });
    };
    return { fetch: fetchImpl, calls };
  }

  interface GridCase {
    label: string;
    itemsCount: number;
    pageSize: number;
    max: number | undefined;
    expectedCollected: Array<z.infer<typeof Card>>;
    expectedRequests: Array<{ limit: string; offset: string }>;
  }

  const grid: GridCase[] = [
    {
      label: "empty source, no max",
      itemsCount: 0,
      pageSize: 5,
      max: undefined,
      expectedCollected: [],
      expectedRequests: [{ limit: "5", offset: "0" }],
    },
    {
      label: "single page exactly fills and stops (total == offset+data)",
      itemsCount: 5,
      pageSize: 5,
      max: undefined,
      expectedCollected: makeItems(5),
      expectedRequests: [{ limit: "5", offset: "0" }],
    },
    {
      label: "two full pages then short tail, no max",
      itemsCount: 7,
      pageSize: 3,
      max: undefined,
      expectedCollected: makeItems(7),
      expectedRequests: [
        { limit: "3", offset: "0" },
        { limit: "3", offset: "3" },
        { limit: "3", offset: "6" },
      ],
    },
    {
      label: "max=0 returns nothing without any fetch",
      itemsCount: 10,
      pageSize: 3,
      max: 0,
      expectedCollected: [],
      expectedRequests: [],
    },
    {
      label: "max=1 with pageSize=1 issues a single request",
      itemsCount: 10,
      pageSize: 1,
      max: 1,
      expectedCollected: makeItems(1),
      expectedRequests: [{ limit: "1", offset: "0" }],
    },
    {
      label: "max mid-page caps the final request to the remaining slots",
      itemsCount: 10,
      pageSize: 4,
      max: 6,
      expectedCollected: makeItems(6),
      expectedRequests: [
        { limit: "4", offset: "0" },
        { limit: "2", offset: "4" },
      ],
    },
    {
      label: "max larger than items still stops when source is exhausted",
      itemsCount: 3,
      pageSize: 2,
      max: 100,
      expectedCollected: makeItems(3),
      expectedRequests: [
        { limit: "2", offset: "0" },
        { limit: "2", offset: "2" },
      ],
    },
    {
      label: "max equal to items.length matches without overshoot",
      itemsCount: 5,
      pageSize: 5,
      max: 5,
      expectedCollected: makeItems(5),
      expectedRequests: [{ limit: "5", offset: "0" }],
    },
    {
      label: "pageSize=1 walks one item per call until total reached",
      itemsCount: 3,
      pageSize: 1,
      max: undefined,
      expectedCollected: makeItems(3),
      expectedRequests: [
        { limit: "1", offset: "0" },
        { limit: "1", offset: "1" },
        { limit: "1", offset: "2" },
      ],
    },
    {
      label: "pageSize larger than items short-circuits after first response",
      itemsCount: 2,
      pageSize: 50,
      max: undefined,
      expectedCollected: makeItems(2),
      expectedRequests: [{ limit: "50", offset: "0" }],
    },
  ];

  it.each(grid)(
    "$label",
    async ({ itemsCount, pageSize, max, expectedCollected, expectedRequests }) => {
      const items = makeItems(itemsCount);
      const handle = buildPagedFetch(items);
      const client = createClient(CONFIG, { fetchImpl: handle.fetch });

      const opts = max === undefined ? { pageSize } : { pageSize, max };
      const collected = await collectPaginated(client, "/api/card", Card, opts);

      expect(collected).toEqual(expectedCollected);
      expect(handle.calls.map(pageOf)).toEqual(expectedRequests);
    },
  );
});
