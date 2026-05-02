import { z, type ZodType } from "zod";

import type { Client } from "../core/http/client";

export const DEFAULT_PAGE_SIZE = 50;

export type PaginationQuery = Record<string, string | number | boolean | undefined>;

export interface PaginateOptions {
  query?: PaginationQuery;
  pageSize?: number;
  max?: number;
  signal?: AbortSignal;
}

export interface PaginatedEnvelope<T> {
  data: T[];
  total?: number | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export async function* paginate<T>(
  client: Client,
  path: string,
  itemSchema: ZodType<T>,
  opts: PaginateOptions = {},
): AsyncIterable<T> {
  const envelopeSchema = paginatedEnvelopeSchema(itemSchema);
  const pageSize = opts.pageSize ?? DEFAULT_PAGE_SIZE;
  const baseQuery = opts.query ?? {};
  const cap = opts.max;

  let offset = 0;
  let yielded = 0;

  while (true) {
    const remaining = cap === undefined ? Number.POSITIVE_INFINITY : cap - yielded;
    if (remaining <= 0) {
      return;
    }
    const requested = Math.min(pageSize, remaining);
    const envelope = await client.requestParsed(envelopeSchema, path, {
      query: { ...baseQuery, limit: requested, offset },
      ...(opts.signal !== undefined && { signal: opts.signal }),
    });

    for (const item of envelope.data) {
      yield item;
      yielded += 1;
      if (cap !== undefined && yielded >= cap) {
        return;
      }
    }

    if (envelope.data.length < requested) {
      return;
    }
    if (envelope.total !== undefined && offset + envelope.data.length >= envelope.total) {
      return;
    }

    offset += envelope.data.length;
  }
}

export async function collectPaginated<T>(
  client: Client,
  path: string,
  itemSchema: ZodType<T>,
  opts: PaginateOptions = {},
): Promise<T[]> {
  const items: T[] = [];
  for await (const item of paginate(client, path, itemSchema, opts)) {
    items.push(item);
  }
  return items;
}

function paginatedEnvelopeSchema<T>(itemSchema: ZodType<T>): ZodType<PaginatedEnvelope<T>> {
  return z
    .object({
      data: z.array(itemSchema),
      total: z.number().int().nonnegative().optional(),
      limit: z.number().int().nonnegative().optional(),
      offset: z.number().int().nonnegative().optional(),
    })
    .passthrough();
}
