import { z } from "zod";

import { Field, type FieldSummary, type FieldUpdateInput, FieldValues } from "../domain/field";
import type { RequestOptions, Transport } from "../http/transport";

// `GET /api/field/{id}/summary` answers a pair of `[name, count]` tuples rather than an object, so
// the counts are decoded into `FieldSummary` before they reach a caller.
const FieldApiSummary = z.tuple([
  z.tuple([z.literal("count"), z.number().int()]),
  z.tuple([z.literal("distincts"), z.number().int()]),
]);

export function fieldResource(transport: Transport) {
  /** Get one field by id. */
  async function get(id: number, options: RequestOptions = {}): Promise<Field> {
    return transport.requestParsed(Field, `/api/field/${id}`, { ...options });
  }

  /** Update a field by id, patching only the fields the body carries. */
  async function update(
    id: number,
    params: FieldUpdateInput,
    options: RequestOptions = {},
  ): Promise<Field> {
    return transport.requestParsed(Field, `/api/field/${id}`, {
      ...options,
      method: "PUT",
      body: params,
    });
  }

  /** Get the row count and the distinct-value count for a field. */
  async function summary(id: number, options: RequestOptions = {}): Promise<FieldSummary> {
    const [[, count], [, distincts]] = await transport.requestParsed(
      FieldApiSummary,
      `/api/field/${id}/summary`,
      { ...options },
    );
    return { field_id: id, count, distincts };
  }

  /** Get the cached distinct values Metabase holds for a field. */
  async function values(id: number, options: RequestOptions = {}): Promise<FieldValues> {
    return transport.requestParsed(FieldValues, `/api/field/${id}/values`, { ...options });
  }

  return { get, update, summary, values };
}
