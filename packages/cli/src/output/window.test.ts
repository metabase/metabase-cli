import { assert, describe, expect, it } from "vitest";
import { z } from "zod";

import { ConfigError } from "@metabase/client/errors";
import {
  type ClientCredentials,
  createTransport,
  type Transport,
} from "@metabase/client/http/transport";
import { type Page, paginatePages } from "@metabase/client/paginate";
import { jsonResponse, TEST_USER_AGENT } from "@metabase/client/testing/fetch-capture";

import { projectForList } from "./projection";
import { DEFAULT_MAX_BYTES, FULL_RANGE, type ListOptions, type ListRange } from "./types";
import type { ResourceView } from "./view";
import {
  collectForOutput,
  type PageRequest,
  type PageSource,
  windowList,
  windowServerPage,
} from "./window";

interface Item {
  id: number;
  name: string;
}

// Metabase's own list default, and what `paginatePages` falls back to when a caller sizes no page.
const SOURCE_PAGE_SIZE = 50;

const itemView: ResourceView<Item> = {
  compactPick: z.object({ id: z.number().int(), name: z.string() }).strip(),
  tableColumns: [{ key: "id" }, { key: "name" }],
};

function makeItems(count: number, start = 0): Item[] {
  return Array.from({ length: count }, (_, index) => ({
    id: start + index,
    name: `item-${start + index}`,
  }));
}

function opts(range: ListRange, maxBytes = DEFAULT_MAX_BYTES): ListOptions {
  return { format: "json", full: false, fields: undefined, maxBytes, range };
}

// The pull stops at the end of whichever page holds the row that spends the budget, so the page
// count follows from the projected row size. Measuring it here through the same `projectForList`
// production measures with keeps a change to the fixture's strings from silently retargeting the
// expectation, which a bare literal would.
function pagesToSpendBudget(
  items: readonly Item[],
  listOpts: ListOptions,
  pageSize: number,
): number {
  let bytes = 0;
  let consumed = 0;
  for (const item of items) {
    bytes += Buffer.byteLength(JSON.stringify(projectForList(item, itemView, listOpts)), "utf8");
    consumed += 1;
    if (bytes > listOpts.maxBytes) {
      break;
    }
  }
  return Math.ceil(consumed / pageSize);
}

describe("windowList", () => {
  it("returns the whole array and reports no continuation", () => {
    expect(windowList(makeItems(3), FULL_RANGE)).toEqual({
      data: makeItems(3),
      returned: 3,
      offset: 0,
      total: 3,
      has_more: false,
      next_offset: null,
    });
  });

  it("slices to the limit and points at the next item", () => {
    expect(windowList(makeItems(10), { offset: 0, limit: 4 })).toEqual({
      data: makeItems(4),
      returned: 4,
      offset: 0,
      limit: 4,
      total: 10,
      has_more: true,
      next_offset: 4,
    });
  });

  it("resumes from an offset and reports exhaustion at the tail", () => {
    expect(windowList(makeItems(10), { offset: 8, limit: 4 })).toEqual({
      data: makeItems(2, 8),
      returned: 2,
      offset: 8,
      limit: 4,
      total: 10,
      has_more: false,
      next_offset: null,
    });
  });

  it("ends the walk on an empty window rather than pointing back at the same offset", () => {
    expect(windowList(makeItems(10), { offset: 3, limit: 0 })).toEqual({
      data: [],
      returned: 0,
      offset: 3,
      limit: 0,
      total: 10,
      has_more: false,
      next_offset: null,
    });
  });

  it("reports the server's count and a continuation when the endpoint held back rows", () => {
    expect(windowList(makeItems(3), FULL_RANGE, 100)).toEqual({
      data: makeItems(3),
      returned: 3,
      offset: 0,
      total: 100,
      has_more: true,
      next_offset: 3,
    });
  });

  it("keeps pointing at the rows in hand when the server's count is smaller than the array", () => {
    expect(windowList(makeItems(10), { offset: 0, limit: 4 }, 3)).toEqual({
      data: makeItems(4),
      returned: 4,
      offset: 0,
      limit: 4,
      total: 3,
      has_more: true,
      next_offset: 4,
    });
  });

  it("reads a null count as the endpoint reporting no count at all", () => {
    const items = makeItems(10);
    const range: ListRange = { offset: 0, limit: 4 };
    expect(windowList(items, range, null)).toEqual(windowList(items, range));
  });

  it("returns nothing when the offset is past the end", () => {
    expect(windowList(makeItems(3), { offset: 99, limit: undefined })).toEqual({
      data: [],
      returned: 0,
      offset: 99,
      total: 3,
      has_more: false,
      next_offset: null,
    });
  });
});

describe("windowServerPage", () => {
  it("trusts the server total to decide whether more remain", () => {
    expect(windowServerPage(makeItems(20), 137, { offset: 20, limit: 20 })).toEqual({
      data: makeItems(20),
      returned: 20,
      offset: 20,
      limit: 20,
      total: 137,
      has_more: true,
      next_offset: 40,
    });
  });

  it("ends the walk when the server reports a total but hands back no rows", () => {
    expect(windowServerPage([], 137, { offset: 40, limit: 20 })).toEqual({
      data: [],
      returned: 0,
      offset: 40,
      limit: 20,
      total: 137,
      has_more: false,
      next_offset: null,
    });
  });

  it("reports no continuation once the window reaches the total", () => {
    expect(windowServerPage(makeItems(7), 27, { offset: 20, limit: 20 })).toEqual({
      data: makeItems(7),
      returned: 7,
      offset: 20,
      limit: 20,
      total: 27,
      has_more: false,
      next_offset: null,
    });
  });
});

interface SourceHandle {
  source: PageSource<Item>;
  pagesPulled: () => number;
  requested: () => PageRequest | undefined;
}

// One request per page, each clamped to the requested `pageSize` and the whole walk clamped to
// `max`, so a request count measured here is a request count over the wire. What it does not model
// is `paginatePages` ending a walk on the server's own count; a property that turns on that ending
// belongs in the composition suite below, driven by the real walker.
function pagedSource(items: Item[], total: number | null, defaultPageSize: number): SourceHandle {
  let pulled = 0;
  let request: PageRequest | undefined;
  const source: PageSource<Item> = (incoming) => {
    request = incoming;
    const pageSize = incoming.pageSize ?? defaultPageSize;
    return (async function* stream() {
      const cap = Math.min(items.length, incoming.max ?? items.length);
      for (let offset = 0; offset < cap; offset += pageSize) {
        pulled += 1;
        yield { items: items.slice(offset, Math.min(offset + pageSize, cap)), total };
      }
    })();
  };
  return { source, pagesPulled: () => pulled, requested: () => request };
}

describe("collectForOutput", () => {
  it("drains a small source and reports no continuation", async () => {
    const handle = pagedSource(makeItems(3), 3, 50);

    const envelope = await collectForOutput(handle.source, itemView, opts(FULL_RANGE));

    expect(envelope).toEqual({
      data: makeItems(3),
      returned: 3,
      offset: 0,
      total: 3,
      has_more: false,
      next_offset: null,
    });
  });

  it("stops pulling pages once the output budget is spent instead of draining 200 pages", async () => {
    const items = makeItems(10_000);
    const listOpts = opts(FULL_RANGE);
    const handle = pagedSource(items, items.length, SOURCE_PAGE_SIZE);
    const expectedPages = pagesToSpendBudget(items, listOpts, SOURCE_PAGE_SIZE);
    const pulled = items.slice(0, expectedPages * SOURCE_PAGE_SIZE);

    const envelope = await collectForOutput(handle.source, itemView, listOpts);

    expect(handle.pagesPulled()).toBe(expectedPages);
    expect(envelope).toEqual({
      data: pulled,
      returned: pulled.length,
      offset: 0,
      total: items.length,
      has_more: true,
      next_offset: pulled.length,
    });
  });

  it("asks the source for one item beyond the limit to prove more exist", async () => {
    const handle = pagedSource(makeItems(100), null, 50);

    const envelope = await collectForOutput(handle.source, itemView, opts({ offset: 0, limit: 4 }));

    expect(handle.requested()).toEqual({ offset: 0, max: 5, pageSize: 5 });
    expect(envelope).toEqual({
      data: makeItems(4),
      returned: 4,
      offset: 0,
      limit: 4,
      total: null,
      has_more: true,
      next_offset: 4,
    });
  });

  it("reports no continuation when an unbounded source runs dry under the limit", async () => {
    const handle = pagedSource(makeItems(3), null, 50);

    const envelope = await collectForOutput(
      handle.source,
      itemView,
      opts({ offset: 0, limit: 10 }),
    );

    expect(envelope).toEqual({
      data: makeItems(3),
      returned: 3,
      offset: 0,
      limit: 10,
      total: null,
      has_more: false,
      next_offset: null,
    });
  });

  it("carries the requested offset into the envelope and the continuation point", async () => {
    const handle = pagedSource(makeItems(10), 500, 50);

    const envelope = await collectForOutput(
      handle.source,
      itemView,
      opts({ offset: 200, limit: 5 }),
    );

    expect(envelope).toEqual({
      data: makeItems(5),
      returned: 5,
      offset: 200,
      limit: 5,
      total: 500,
      has_more: true,
      next_offset: 205,
    });
  });

  it("drains without a byte budget when the cap is disabled", async () => {
    const handle = pagedSource(makeItems(500), null, SOURCE_PAGE_SIZE);

    const envelope = await collectForOutput(handle.source, itemView, opts(FULL_RANGE, 0));

    expect(envelope).toEqual({
      data: makeItems(500),
      returned: 500,
      offset: 0,
      total: null,
      has_more: false,
      next_offset: null,
    });
  });

  it("reports a continuation when the byte budget stops a source that reports no count", async () => {
    const handle = pagedSource(makeItems(100), null, 10);

    const envelope = await collectForOutput(handle.source, itemView, opts(FULL_RANGE, 100));

    expect(envelope).toEqual({
      data: makeItems(10),
      returned: 10,
      offset: 0,
      total: null,
      has_more: true,
      next_offset: 10,
    });
  });

  it("adopts a total first reported by a later page", async () => {
    const source = (): AsyncIterable<Page<Item>> =>
      (async function* stream() {
        yield { items: makeItems(2), total: null };
        yield { items: makeItems(2, 2), total: 4 };
      })();

    const envelope = await collectForOutput(source, itemView, opts(FULL_RANGE));

    expect(envelope).toEqual({
      data: makeItems(4),
      returned: 4,
      offset: 0,
      total: 4,
      has_more: false,
      next_offset: null,
    });
  });

  it("returns an empty envelope when the source yields no pages at all", async () => {
    const handle = pagedSource([], null, 50);

    const envelope = await collectForOutput(handle.source, itemView, opts(FULL_RANGE));

    expect(envelope).toEqual({
      data: [],
      returned: 0,
      offset: 0,
      total: null,
      has_more: false,
      next_offset: null,
    });
  });

  it("fetches a page-size-multiple limit and its probe item in a single request", async () => {
    const handle = pagedSource(makeItems(1000), null, 50);

    await collectForOutput(handle.source, itemView, opts({ offset: 0, limit: 50 }));

    expect(handle.pagesPulled()).toBe(1);
  });

  it("keeps a very large limit arriving in several pages rather than one", async () => {
    const handle = pagedSource(makeItems(1000), null, 50);

    await collectForOutput(handle.source, itemView, opts({ offset: 0, limit: 500 }, 0));

    expect(handle.pagesPulled()).toBe(3);
  });

  it("enriches an envelope-relative --fields path with the item-relative hint", async () => {
    const handle = pagedSource(makeItems(3), 3, 50);
    const listOpts: ListOptions = { ...opts(FULL_RANGE), fields: ["data.id"] };

    const error = await collectForOutput(handle.source, itemView, listOpts).catch(
      (thrown: unknown) => thrown,
    );

    assert(error instanceof ConfigError, "expected a ConfigError");
    expect(error.message).toBe(
      'unknown field path: "data.id" — on list commands --fields paths are relative to each item in `data`, not the envelope. Drop the `data.` prefix (e.g. use `id` instead of `data.id`).',
    );
  });
});

const CREDENTIALS: ClientCredentials = {
  url: "https://m.example.com",
  credential: { kind: "apiKey", apiKey: "mb_test_key" },
};

const ItemSchema = z.object({ id: z.number().int(), name: z.string() });

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") {
    return input;
  }
  return input instanceof URL ? input.toString() : input.url;
}

// A list endpoint that honours `limit` and `offset` and answers `reportedTotal` as its count. An
// honest server reports the rows it holds; a smaller number is a count its own rows disprove.
function pagingTransport(items: Item[], reportedTotal: number): Transport {
  const fetchImpl: typeof fetch = async (input) => {
    const params = new URL(requestUrl(input)).searchParams;
    const offset = Number(params.get("offset"));
    const limit = Number(params.get("limit"));
    return jsonResponse({ data: items.slice(offset, offset + limit), total: reportedTotal });
  };
  return createTransport(CREDENTIALS, { userAgent: TEST_USER_AGENT, fetchImpl });
}

function pageSourceOver(transport: Transport): PageSource<Item> {
  return (request) => paginatePages(transport, "/api/item", ItemSchema, request);
}

// The continuation an agent follows is a property of the composition, not of `collectForOutput`
// alone: `paginatePages` decides when a walk is over, and a fake standing in for it decides that
// question in the test's favour. These drive the real walker over a scripted endpoint.
describe("collectForOutput over paginatePages", () => {
  it("keeps the continuation the walk proved when the server total under-counts the rows", async () => {
    const source = pageSourceOver(pagingTransport(makeItems(6), 3));

    const envelope = await collectForOutput(source, itemView, opts({ offset: 0, limit: 5 }));

    expect(envelope).toEqual({
      data: makeItems(5),
      returned: 5,
      offset: 0,
      limit: 5,
      total: 3,
      has_more: true,
      next_offset: 5,
    });
  });

  // The request `collectForOutput` hands a source carries the window's start, so forwarding it
  // whole is what makes `--offset` reach the endpoint. A source that rebuilds the request field by
  // field can drop it and silently re-serve the first page as if it were the resumption point.
  it("resumes the walk from the requested offset", async () => {
    const source = pageSourceOver(pagingTransport(makeItems(10), 10));

    const envelope = await collectForOutput(source, itemView, opts({ offset: 3, limit: 2 }));

    expect(envelope).toEqual({
      data: makeItems(2, 3),
      returned: 2,
      offset: 3,
      limit: 2,
      total: 10,
      has_more: true,
      next_offset: 5,
    });
  });

  it("hands back every row the walk found when the server total stopped short of them", async () => {
    const source = pageSourceOver(pagingTransport(makeItems(120), 3));

    const envelope = await collectForOutput(source, itemView, opts(FULL_RANGE));

    expect(envelope).toEqual({
      data: makeItems(120),
      returned: 120,
      offset: 0,
      total: 3,
      has_more: false,
      next_offset: null,
    });
  });
});
