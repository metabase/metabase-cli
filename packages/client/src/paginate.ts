import { z, type ZodType } from "zod";

import { ConfigError, InternalError } from "./errors";
import type { Transport, QueryValue } from "./http/transport";

export const DEFAULT_PAGE_SIZE = 50;

export interface PaginateOptions {
  query?: Record<string, QueryValue>;
  pageSize?: number;
  offset?: number;
  max?: number;
  signal?: AbortSignal;
}

export interface Page<T> {
  items: T[];
  total: number | null;
}

export interface PaginatedEnvelope<T> {
  data: T[];
  total?: number | null | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export async function* paginatePages<T>(
  client: Transport,
  path: string,
  itemSchema: ZodType<T>,
  opts: PaginateOptions = {},
): AsyncIterable<Page<T>> {
  const envelopeSchema = paginatedEnvelopeSchema(itemSchema);
  const pageSize = opts.pageSize ?? DEFAULT_PAGE_SIZE;
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    throw new InternalError(`pageSize must be an integer of at least 1, got ${pageSize}`);
  }
  const start = opts.offset ?? 0;
  const max = opts.max ?? Number.POSITIVE_INFINITY;

  let taken = 0;
  let previousHead: string | null = null;
  while (taken < max) {
    const remaining = max - taken;
    const limit = Math.min(pageSize, remaining);
    const offset = start + taken;
    const envelope = await client.requestParsed(envelopeSchema, path, {
      query: { ...opts.query, limit, offset },
      ...(opts.signal !== undefined && { signal: opts.signal }),
    });

    const items =
      envelope.data.length > remaining ? envelope.data.slice(0, remaining) : envelope.data;
    const total = envelope.total ?? null;
    const head = items.length === 0 ? null : JSON.stringify(items[0]);
    // A server that ignores `offset` hands back the rows it already handed back, so the walk either
    // requests forever or serves the same rows twice under a count that bounds it. Neither is a
    // listing, so a repeated head row ends it loudly.
    const repeatsPreviousPage = head !== null && head === previousHead;
    if (repeatsPreviousPage) {
      throw new ConfigError(
        `the endpoint returned the same first row at offset ${offset} as at the previous offset; it is ignoring the offset parameter, so paging cannot advance`,
      );
    }
    previousHead = head;
    yield { items, total };

    // Without a server count, only an empty page proves exhaustion: a short page can also come from
    // a server-side page cap or a filter applied after the limit, and stopping there drops the tail.
    if (items.length === 0) {
      return;
    }
    const consumed = taken + items.length;
    // Only a count the rows corroborate ends the walk. A server that has already handed back more
    // rows than it counted has disproved its own count, and stopping on it would strand every row
    // past the page in hand — so the walk keeps going until a page comes back empty.
    const reachedServerTotal = total !== null && start + consumed === total;
    if (reachedServerTotal) {
      return;
    }
    taken = consumed;
  }
}

function paginatedEnvelopeSchema<T>(itemSchema: ZodType<T>): ZodType<PaginatedEnvelope<T>> {
  return z
    .object({
      data: z.array(itemSchema),
      total: z.number().int().nonnegative().nullable().optional(),
      limit: z.number().int().nonnegative().optional(),
      offset: z.number().int().nonnegative().optional(),
    })
    .loose();
}
