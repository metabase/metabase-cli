import type { Page, PaginateOptions } from "@metabase/client/paginate";

import { projectForList } from "./projection";
import type { ListEnvelope, ListOptions, ListRange } from "./types";
import type { ResourceView } from "./view";

// What `collectForOutput` asks a page stream for. `max` is the item ceiling — one beyond the
// caller's window, because getting that item back is what proves more items exist. `pageSize` is
// how many to fetch per request; an absent one leaves the stream's own default in place. The shape
// is the client's own page options minus what the caller of a stream supplies, so a source forwards
// the request whole rather than copying fields across and stranding rows by dropping `offset`.
export interface PageRequest extends Omit<PaginateOptions, "query" | "signal"> {
  offset: number;
}

export type PageSource<T> = (request: PageRequest) => AsyncIterable<Page<T>>;

// A caller-sized window is fetched in one request, probe item included: at the 50-row default
// page size, `--limit 50` otherwise spends a whole round trip on the single row that proves more
// remain, and `--limit 100`/`--limit 150` do the same. The ceiling keeps a very large `--limit`
// from arriving as one page the byte budget can no longer stop part-way through.
const MAX_REQUEST_PAGE_SIZE = 200;

// The endpoint returned everything, so the window is a client-side slice. `serverTotal` is the
// count the endpoint reported alongside those rows: an endpoint that reports more rows than it
// handed over has handed over a partial result, and without the count the slice would report
// itself complete. `null` and an omitted argument both say the endpoint reports no count, so a
// caller holding an optional count can forward it as it stands.
export function windowList<T>(
  items: T[],
  range: ListRange,
  serverTotal?: number | null,
): ListEnvelope<T> {
  const held = items.length;
  const start = Math.min(range.offset, held);
  const end = range.limit === undefined ? held : Math.min(start + range.limit, held);
  const total = serverTotal ?? held;
  // Rows past the window are counted in the array, rows the endpoint withheld only in its count.
  // Reading both off `total` would compare an array index against a server-wide number, and a
  // count smaller than the rows in hand would then bury the tail of the array.
  const beyondWindow = end < held;
  const withheldByServer = held < total;
  return buildEnvelope(items.slice(start, end), range, total, beyondWindow || withheldByServer);
}

// For endpoints that applied the window themselves: `data` is already the requested slice, and
// `total` is the server's count across the whole result set. An endpoint that pages without
// reporting a count cannot use this helper — it has no way to know whether more remain, so it
// belongs on `collectForOutput`, which learns the answer by pulling one item past the window.
export function windowServerPage<T>(data: T[], total: number, range: ListRange): ListEnvelope<T> {
  return buildEnvelope(data, range, total, range.offset + data.length < total);
}

// Pulls only as far as the output budget can display, so a 10k-item collection stops within a
// page of the cap rather than draining a full 200 pages the cap then discards. A window the
// caller sized is fetched in one request; without a `--limit` the walk still advances a page at a
// time, because only the fetched rows reveal how many of them the budget buys — so an unbounded
// listing costs roughly `budget / page bytes` requests. Items beyond the budget are still handed
// to the cap, which trims them and reports the resumption point. The budget is measured over rows
// alone, which under-counts the rendered envelope: stopping a page early is free, since the cap
// re-trims and recomputes the resumption point anyway.
export async function collectForOutput<T>(
  source: PageSource<T>,
  view: ResourceView<T>,
  opts: ListOptions,
): Promise<ListEnvelope<T>> {
  const { range } = opts;
  const budget = opts.maxBytes <= 0 ? Number.POSITIVE_INFINITY : opts.maxBytes;
  const fetchMax = range.limit === undefined ? undefined : range.limit + 1;
  const request: PageRequest = {
    offset: range.offset,
    ...(fetchMax !== undefined && {
      max: fetchMax,
      pageSize: Math.min(fetchMax, MAX_REQUEST_PAGE_SIZE),
    }),
  };

  const items: T[] = [];
  let total: number | null = null;
  let bytes = 0;
  let exhausted = true;

  for await (const page of source(request)) {
    total = page.total ?? total;
    for (const item of page.items) {
      items.push(item);
      bytes += measure(item, view, opts);
    }
    const budgetSpent = bytes > budget;
    const capReached = fetchMax !== undefined && items.length >= fetchMax;
    if (budgetSpent || capReached) {
      exhausted = false;
      break;
    }
  }

  const limit = range.limit;
  const data = limit !== undefined && items.length > limit ? items.slice(0, limit) : items;
  // Only a stream that ran dry proves there is nothing left. Breaking early — on the byte budget
  // or on the extra item pulled past the window — means more may remain no matter what `total`
  // claims, and a server count that disagrees is the count that is wrong.
  return buildEnvelope(data, range, total, !exhausted);
}

// `moreAvailable` is the caller's finding, not a derivation from `total`: over-reporting costs one
// wasted request, while under-reporting strands rows the caller can never ask for again.
function buildEnvelope<T>(
  data: T[],
  range: ListRange,
  total: number | null,
  moreAvailable: boolean,
): ListEnvelope<T> {
  const returned = data.length;
  // Without a row in hand there is nowhere to resume from: `next_offset` would equal `offset`
  // and the caller would re-request the window it just got. An empty window ends the walk.
  const hasMore = returned > 0 && moreAvailable;
  return {
    data,
    returned,
    offset: range.offset,
    ...(range.limit !== undefined && { limit: range.limit }),
    total,
    has_more: hasMore,
    next_offset: hasMore ? range.offset + returned : null,
  };
}

// Measured through the same projection the renderer will apply, `--json` and text alike: a full
// API object can be ten times its compact view, and estimating on the raw shape would stop the
// pull long before the output budget is actually spent.
function measure<T>(item: T, view: ResourceView<T>, opts: ListOptions): number {
  return Buffer.byteLength(JSON.stringify(projectForList(item, view, opts)), "utf8");
}
