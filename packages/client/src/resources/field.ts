import { z } from "zod";

import {
  Field,
  FieldRemappedValue,
  FieldSearchMatches,
  type FieldSummary,
  type FieldUpdateInput,
  FieldValues,
} from "../domain/field";
import type { RequestOptions, Transport } from "../http/transport";

import { fetchOptionalParsed } from "./optional-parsed";

// `GET /api/field/{id}/summary` answers a pair of `[name, count]` tuples rather than an object, so
// the counts are decoded into `FieldSummary` before they reach a caller.
const FieldApiSummary = z.tuple([
  z.tuple([z.literal("count"), z.number().int()]),
  z.tuple([z.literal("distincts"), z.number().int()]),
]);

// A search needs a bound: `value` narrows the matches to those containing it, and without one the
// server insists on `limit`.
export interface FieldSearchByValue {
  value: string;
  limit?: number | undefined;
}

export interface FieldSearchBounded {
  value?: undefined;
  limit: number;
}

export type FieldSearchParams = FieldSearchByValue | FieldSearchBounded;

export interface FieldRemappingParams {
  value: string;
}

// Every path parameter here is a numeric id, so no fragment needs `encodeURIComponent`.
export function fieldResource(transport: Transport) {
  /** Get one field by id. */
  async function get(id: number, options: RequestOptions = {}): Promise<Field> {
    await transport.require("field.get", options);
    return transport.requestParsed(Field, `/api/field/${id}`, { ...options });
  }

  /**
   * Update a field by id, patching only the fields the body carries. A `data_sensitivity` label is
   * a person's call the server's classifier never overwrites, and `null` withdraws it so the
   * classifier's own applies again; a server without the column would drop the key silently, so
   * the label is refused there before the wire.
   */
  async function update(
    id: number,
    params: FieldUpdateInput,
    options: RequestOptions = {},
  ): Promise<Field> {
    await transport.require("field.update", options);
    await transport.requireFeatures(
      params.data_sensitivity === undefined ? [] : ["fieldDataSensitivity"],
      options,
    );
    return transport.requestParsed(Field, `/api/field/${id}`, {
      ...options,
      method: "PUT",
      body: params,
    });
  }

  /**
   * Search the values of `searchId` that contain `value`, case-insensitively, answering the
   * matching values of `id` paired with them. An FK on either side is followed to the PK it
   * points at. Without `value`, the first `limit` values.
   */
  async function search(
    id: number,
    searchId: number,
    params: FieldSearchParams,
    options: RequestOptions = {},
  ): Promise<FieldSearchMatches> {
    await transport.require("field.search", options);
    return transport.requestParsed(FieldSearchMatches, `/api/field/${id}/search/${searchId}`, {
      ...options,
      query: { value: params.value, limit: params.limit },
    });
  }

  /**
   * The value of `remappedId` on the one row where `id` equals `value`, as `[value, remapped]`,
   * or `null` when no row matches. `value` is parsed as a number for a numeric field.
   */
  async function remapping(
    id: number,
    remappedId: number,
    params: FieldRemappingParams,
    options: RequestOptions = {},
  ): Promise<FieldRemappedValue | null> {
    await transport.require("field.remapping", options);
    return fetchOptionalParsed(
      transport,
      `/api/field/${id}/remapping/${remappedId}`,
      FieldRemappedValue,
      { ...options, query: { value: params.value } },
    );
  }

  /** Get the row count and the distinct-value count for a field. */
  async function summary(id: number, options: RequestOptions = {}): Promise<FieldSummary> {
    await transport.require("field.summary", options);
    const [[, count], [, distincts]] = await transport.requestParsed(
      FieldApiSummary,
      `/api/field/${id}/summary`,
      { ...options },
    );
    return { field_id: id, count, distincts };
  }

  /** Get the cached distinct values Metabase holds for a field. */
  async function values(id: number, options: RequestOptions = {}): Promise<FieldValues> {
    await transport.require("field.values", options);
    return transport.requestParsed(FieldValues, `/api/field/${id}/values`, { ...options });
  }

  return { get, update, search, remapping, summary, values };
}
