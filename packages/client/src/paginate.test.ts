import { assert, describe, expect, it } from "vitest";
import { z, type ZodType } from "zod";

import { AbortError, ConfigError, errorMessage, InternalError } from "./errors";
import { type Transport, type ClientCredentials, createTransport } from "./http/transport";
import { TEST_USER_AGENT } from "./testing/fetch-capture";
import { type Page, type PaginateOptions, paginatePages } from "./paginate";

const CONFIG: ClientCredentials = {
  url: "https://m.example.com",
  credential: { kind: "apiKey", apiKey: "mb_test_key" },
};

const Card = z.object({ id: z.number().int(), name: z.string() });

async function collect<T>(
  client: Transport,
  path: string,
  itemSchema: ZodType<T>,
  opts: PaginateOptions = {},
): Promise<T[]> {
  const items: T[] = [];
  for await (const page of paginatePages(client, path, itemSchema, opts)) {
    items.push(...page.items);
  }
  return items;
}

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

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") {
    return input;
  }
  return input instanceof URL ? input.toString() : input.url;
}

function makeFakeFetch(script: FetchScriptResponse[]): FakeFetchHandle {
  const queue = [...script];
  const calls: FetchCallRecord[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ url: requestUrl(input), method: init?.method ?? "GET" });
    const next = queue.shift();
    assert(next !== undefined, "fakeFetch: no more responses queued");
    return new Response(JSON.stringify(next.body), {
      headers: { "content-type": "application/json" },
    });
  };
  return { fetch: fetchImpl, calls };
}

interface CappedSource {
  items: Array<z.infer<typeof Card>>;
  perRequest: number;
}

// A server that honours `offset` but never returns more than `perRequest` rows, and reports no
// count — every page below the requested limit, none of them the end until the rows run out.
function makeCappedFetch(source: CappedSource): FakeFetchHandle {
  const calls: FetchCallRecord[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = requestUrl(input);
    calls.push({ url, method: init?.method ?? "GET" });
    const params = new URL(url).searchParams;
    const limitParam = params.get("limit");
    const offsetParam = params.get("offset");
    assert(limitParam !== null && offsetParam !== null, "paginate must send both limit and offset");
    const offset = Number(offsetParam);
    const size = Math.min(Number(limitParam), source.perRequest);
    return new Response(JSON.stringify({ data: source.items.slice(offset, offset + size) }), {
      headers: { "content-type": "application/json" },
    });
  };
  return { fetch: fetchImpl, calls };
}

function makeOffsetIgnoringFetch(
  page: Array<z.infer<typeof Card>>,
  total?: number,
): FakeFetchHandle {
  const calls: FetchCallRecord[] = [];
  const body = total === undefined ? { data: page } : { data: page, total };
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ url: requestUrl(input), method: init?.method ?? "GET" });
    return new Response(JSON.stringify(body), {
      headers: { "content-type": "application/json" },
    });
  };
  return { fetch: fetchImpl, calls };
}

// A server that honours both `limit` and `offset` exactly. `reportedTotal` is the count it claims,
// which an honest server states as the number of rows it holds.
function buildPagedFetch(
  items: Array<z.infer<typeof Card>>,
  reportedTotal?: number,
): FakeFetchHandle {
  const calls: FetchCallRecord[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = requestUrl(input);
    calls.push({ url, method: init?.method ?? "GET" });
    const params = new URL(url).searchParams;
    const limitParam = params.get("limit");
    const offsetParam = params.get("offset");
    assert(
      limitParam !== null && offsetParam !== null,
      "paginate must always send both limit and offset",
    );
    const slice = items.slice(Number(offsetParam), Number(offsetParam) + Number(limitParam));
    return new Response(JSON.stringify({ data: slice, total: reportedTotal ?? items.length }), {
      headers: { "content-type": "application/json" },
    });
  };
  return { fetch: fetchImpl, calls };
}

// Pages like `buildPagedFetch`, but the caller trips `controller` while the nominated request is in
// flight. Rejecting with the signal's own reason is what a real `fetch` does on abort, so the abort
// travels back out through the client instead of being simulated.
function makeAbortingFetch(
  items: Array<z.infer<typeof Card>>,
  controller: AbortController,
  abortOnCall: number,
): FakeFetchHandle {
  const paged = buildPagedFetch(items);
  const fetchImpl: typeof fetch = async (input, init) => {
    const response = await paged.fetch(input, init);
    if (paged.calls.length === abortOnCall) {
      controller.abort(new Error("user cancelled the listing"));
    }
    const signal = init?.signal;
    if (signal?.aborted === true) {
      const reason: unknown = signal.reason;
      throw reason;
    }
    return response;
  };
  return { fetch: fetchImpl, calls: paged.calls };
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
  it("yields items from a single page and stops once the server total is reached", async () => {
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
    const client = createTransport(CONFIG, { userAgent: TEST_USER_AGENT, fetchImpl: handle.fetch });

    const items = await collect(client, "/api/card", Card, { pageSize: 50 });

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
    const client = createTransport(CONFIG, { userAgent: TEST_USER_AGENT, fetchImpl: handle.fetch });

    const items = await collect(client, "/api/card", Card, { pageSize: 2 });

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
    const client = createTransport(CONFIG, { userAgent: TEST_USER_AGENT, fetchImpl: handle.fetch });

    const items = await collect(client, "/api/card", Card, { pageSize: 2, max: 1 });

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
    const client = createTransport(CONFIG, { userAgent: TEST_USER_AGENT, fetchImpl: handle.fetch });

    await collect(client, "/api/card", Card, { pageSize: 2, max: 3 });

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
    const client = createTransport(CONFIG, { userAgent: TEST_USER_AGENT, fetchImpl: handle.fetch });

    await collect(client, "/api/search", Card, {
      pageSize: 1,
      query: { q: "hello", archived: false },
    });

    for (const call of handle.calls) {
      const params = urlOf(call).searchParams;
      expect(params.get("q")).toBe("hello");
      expect(params.get("archived")).toBe("false");
    }
  });

  it("keeps paging past a short page when the endpoint reports no total", async () => {
    const all = makeItems(1000);
    const handle = makeCappedFetch({ items: all, perRequest: 30 });
    const client = createTransport(CONFIG, { userAgent: TEST_USER_AGENT, fetchImpl: handle.fetch });

    const items = await collect(client, "/api/card", Card, { pageSize: 50 });

    expect(items).toEqual(all);
    expect(handle.calls).toHaveLength(35);
  });

  it("refuses to page an endpoint that ignores offset and reports no total", async () => {
    const handle = makeOffsetIgnoringFetch(makeItems(3));
    const client = createTransport(CONFIG, { userAgent: TEST_USER_AGENT, fetchImpl: handle.fetch });

    const error = await collect(client, "/api/card", Card, { pageSize: 3 }).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(ConfigError);
    expect(errorMessage(error)).toBe(
      "the endpoint returned the same first row at offset 3 as at the previous offset; it is ignoring the offset parameter, so paging cannot advance",
    );
    expect(handle.calls).toHaveLength(2);
  });

  it("refuses to page an endpoint that ignores offset even when its count bounds the walk", async () => {
    const handle = makeOffsetIgnoringFetch(makeItems(3), 6);
    const client = createTransport(CONFIG, { userAgent: TEST_USER_AGENT, fetchImpl: handle.fetch });

    const error = await collect(client, "/api/card", Card, { pageSize: 3 }).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(ConfigError);
    expect(errorMessage(error)).toBe(
      "the endpoint returned the same first row at offset 3 as at the previous offset; it is ignoring the offset parameter, so paging cannot advance",
    );
    expect(handle.calls).toHaveLength(2);
  });

  it("keeps paging past a count the rows already exceed rather than stranding the tail", async () => {
    const all = makeItems(7);
    const handle = buildPagedFetch(all, 2);
    const client = createTransport(CONFIG, { userAgent: TEST_USER_AGENT, fetchImpl: handle.fetch });

    const items = await collect(client, "/api/card", Card, { pageSize: 3 });

    expect(items).toEqual(all);
    expect(handle.calls.map(pageOf)).toEqual([
      { limit: "3", offset: "0" },
      { limit: "3", offset: "3" },
      { limit: "3", offset: "6" },
      { limit: "3", offset: "7" },
    ]);
  });

  it("yields the whole page when the server ignores limit and returns everything", async () => {
    const all = makeItems(10);
    const handle = makeFakeFetch([{ body: { data: all, total: 10 } }]);
    const client = createTransport(CONFIG, { userAgent: TEST_USER_AGENT, fetchImpl: handle.fetch });

    const items = await collect(client, "/api/card", Card, { pageSize: 3 });

    expect(items).toEqual(all);
    expect(handle.calls).toHaveLength(1);
  });

  it("caps yielded items at max when the server returns more than the requested limit", async () => {
    const handle = makeFakeFetch([{ body: { data: makeItems(4), total: 100 } }]);
    const client = createTransport(CONFIG, { userAgent: TEST_USER_AGENT, fetchImpl: handle.fetch });

    const items = await collect(client, "/api/card", Card, { pageSize: 4, max: 3 });

    expect(items).toEqual(makeItems(3));
    expect(handle.calls.map(pageOf)).toEqual([{ limit: "3", offset: "0" }]);
  });

  it("starts at the requested offset and keeps advancing from there", async () => {
    const handle = makeFakeFetch([
      { body: { data: [{ id: 5, name: "e" }], total: 7 } },
      { body: { data: [{ id: 6, name: "f" }], total: 7 } },
      { body: { data: [{ id: 7, name: "g" }], total: 7 } },
    ]);
    const client = createTransport(CONFIG, { userAgent: TEST_USER_AGENT, fetchImpl: handle.fetch });

    const items = await collect(client, "/api/card", Card, { pageSize: 1, offset: 4 });

    expect(items).toEqual([
      { id: 5, name: "e" },
      { id: 6, name: "f" },
      { id: 7, name: "g" },
    ]);
    expect(handle.calls.map(pageOf)).toEqual([
      { limit: "1", offset: "4" },
      { limit: "1", offset: "5" },
      { limit: "1", offset: "6" },
    ]);
  });

  it("offsets from the requested start and clamps the final limit when max and offset combine", async () => {
    const handle = buildPagedFetch(makeItems(10));
    const client = createTransport(CONFIG, { userAgent: TEST_USER_AGENT, fetchImpl: handle.fetch });

    const items = await collect(client, "/api/card", Card, {
      pageSize: 3,
      offset: 4,
      max: 4,
    });

    expect(items).toEqual(makeItems(10).slice(4, 8));
    expect(handle.calls.map(pageOf)).toEqual([
      { limit: "3", offset: "4" },
      { limit: "1", offset: "7" },
    ]);
  });

  it("stops requesting pages when the caller's signal aborts mid-walk", async () => {
    const controller = new AbortController();
    const handle = makeAbortingFetch(makeItems(10), controller, 2);
    const client = createTransport(CONFIG, { userAgent: TEST_USER_AGENT, fetchImpl: handle.fetch });

    const error = await collect(client, "/api/card", Card, {
      pageSize: 2,
      signal: controller.signal,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AbortError);
    expect(errorMessage(error)).toBe("user cancelled the listing");
    expect(handle.calls.map(pageOf)).toEqual([
      { limit: "2", offset: "0" },
      { limit: "2", offset: "2" },
    ]);
  });

  it("reports the server total on every page it yields", async () => {
    const handle = makeFakeFetch([
      { body: { data: makeItems(4).slice(0, 2), total: 42 } },
      { body: { data: makeItems(4).slice(2), total: 42 } },
    ]);
    const client = createTransport(CONFIG, { userAgent: TEST_USER_AGENT, fetchImpl: handle.fetch });

    const totals: Array<number | null> = [];
    for await (const page of paginatePages(client, "/api/card", Card, { pageSize: 2, max: 4 })) {
      totals.push(page.total);
    }

    expect(totals).toEqual([42, 42]);
  });

  it("reports a null total when the endpoint omits one", async () => {
    const handle = makeFakeFetch([
      { body: { data: [{ id: 1, name: "a" }] } },
      { body: { data: [] } },
    ]);
    const client = createTransport(CONFIG, { userAgent: TEST_USER_AGENT, fetchImpl: handle.fetch });

    const pages: Array<Page<z.infer<typeof Card>>> = [];
    for await (const page of paginatePages(client, "/api/card", Card, { pageSize: 50 })) {
      pages.push(page);
    }

    expect(pages).toEqual([
      { items: [{ id: 1, name: "a" }], total: null },
      { items: [], total: null },
    ]);
  });

  it("rejects a pageSize below 1 instead of looping on a page that can never advance", async () => {
    const handle = makeFakeFetch([]);
    const client = createTransport(CONFIG, { userAgent: TEST_USER_AGENT, fetchImpl: handle.fetch });

    const error = await collect(client, "/api/card", Card, { pageSize: 0 }).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(InternalError);
    expect(errorMessage(error)).toBe("pageSize must be an integer of at least 1, got 0");
    expect(handle.calls).toEqual([]);
  });

  it("rejects a NaN pageSize rather than sending limit=NaN to the endpoint", async () => {
    const handle = makeFakeFetch([]);
    const client = createTransport(CONFIG, { userAgent: TEST_USER_AGENT, fetchImpl: handle.fetch });

    const error = await collect(client, "/api/card", Card, { pageSize: Number.NaN }).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(InternalError);
    expect(errorMessage(error)).toBe("pageSize must be an integer of at least 1, got NaN");
    expect(handle.calls).toEqual([]);
  });

  it("rejects an infinite pageSize rather than sending limit=Infinity to the endpoint", async () => {
    const handle = makeFakeFetch([]);
    const client = createTransport(CONFIG, { userAgent: TEST_USER_AGENT, fetchImpl: handle.fetch });

    const error = await collect(client, "/api/card", Card, {
      pageSize: Number.POSITIVE_INFINITY,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(InternalError);
    expect(errorMessage(error)).toBe("pageSize must be an integer of at least 1, got Infinity");
    expect(handle.calls).toEqual([]);
  });

  it("rejects a fractional pageSize rather than sending a non-integer limit", async () => {
    const handle = makeFakeFetch([]);
    const client = createTransport(CONFIG, { userAgent: TEST_USER_AGENT, fetchImpl: handle.fetch });

    const error = await collect(client, "/api/card", Card, { pageSize: 2.5 }).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(InternalError);
    expect(errorMessage(error)).toBe("pageSize must be an integer of at least 1, got 2.5");
    expect(handle.calls).toEqual([]);
  });

  it("rejects pages whose items fail schema validation", async () => {
    const handle = makeFakeFetch([{ body: { data: [{ id: "not-a-number", name: "x" }] } }]);
    const client = createTransport(CONFIG, { userAgent: TEST_USER_AGENT, fetchImpl: handle.fetch });

    const error = await collect(client, "/api/card", Card).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
  });

  it("preserves passthrough fields in the envelope without affecting yielded items", async () => {
    const handle = makeFakeFetch([
      { body: { data: [{ id: 1, name: "a" }], total: 1, models: ["card"] } },
    ]);
    const client = createTransport(CONFIG, { userAgent: TEST_USER_AGENT, fetchImpl: handle.fetch });

    const items = await collect(client, "/api/search", Card);
    expect(items).toEqual([{ id: 1, name: "a" }]);
  });

  it("accepts total: null on an empty page without falling over (collection-items shape)", async () => {
    const handle = makeFakeFetch([{ body: { data: [], total: null, models: ["card"] } }]);
    const client = createTransport(CONFIG, { userAgent: TEST_USER_AGENT, fetchImpl: handle.fetch });

    const items = await collect(client, "/api/collection/8/items", Card, { pageSize: 50 });

    expect(items).toEqual([]);
    expect(handle.calls).toHaveLength(1);
  });

  it("treats total: null as unknown total and continues paginating until an empty page", async () => {
    const handle = makeFakeFetch([
      { body: { data: [{ id: 1, name: "a" }], total: null } },
      { body: { data: [{ id: 2, name: "b" }], total: null } },
      { body: { data: [], total: null } },
    ]);
    const client = createTransport(CONFIG, { userAgent: TEST_USER_AGENT, fetchImpl: handle.fetch });

    const items = await collect(client, "/api/card", Card, { pageSize: 1 });

    expect(items).toEqual([
      { id: 1, name: "a" },
      { id: 2, name: "b" },
    ]);
    expect(handle.calls).toHaveLength(3);
  });
});

describe("paginate edge-case grid", () => {
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
      const client = createTransport(CONFIG, {
        userAgent: TEST_USER_AGENT,
        fetchImpl: handle.fetch,
      });

      const opts = max === undefined ? { pageSize } : { pageSize, max };
      const collected = await collect(client, "/api/card", Card, opts);

      expect(collected).toEqual(expectedCollected);
      expect(handle.calls.map(pageOf)).toEqual(expectedRequests);
    },
  );
});
