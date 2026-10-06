import { z } from "zod";

import {
  type FieldDataSensitivity,
  type FieldDetail,
  fieldDetailSchema,
  type FieldRemappedValue,
  fieldRemappedValueSchema,
  FieldSearchMatches,
  type FieldSummary,
  type FieldUpdateInput,
  FieldValues,
  FieldWithDataSensitivity,
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

export interface FieldSetDataSensitivityParams {
  data_sensitivity: FieldDataSensitivity | null;
}

// Every path parameter here is a numeric id, so no fragment needs `encodeURIComponent`.
export function fieldResource(transport: Transport) {
  /**
   * Get one field by id. A server that labels data sensitivity answers `data_sensitivity`, `null`
   * for an unlabelled field; any other answers the field without the key (`hasDataSensitivity`).
   */
  async function get(id: number, options: RequestOptions = {}): Promise<FieldDetail> {
    const { features } = await transport.server(options);
    return transport.requestParsed(fieldDetailSchema(features), `/api/field/${id}`, { ...options });
  }

  /**
   * Update a field by id, patching only the fields the body carries. A `data_sensitivity` label is
   * a person's call the server's classifier never overwrites, and `null` withdraws it so the
   * classifier's own applies again; a server without the column would drop the key silently, so
   * the label is refused there before the wire. Answers the field the way `get` does.
   */
  async function update(
    id: number,
    params: FieldUpdateInput,
    options: RequestOptions = {},
  ): Promise<FieldDetail> {
    await transport.requireFeatures(
      params.data_sensitivity === undefined ? [] : ["fieldDataSensitivity"],
      options,
    );
    const { features } = await transport.server(options);
    return transport.requestParsed(fieldDetailSchema(features), `/api/field/${id}`, {
      ...options,
      method: "PUT",
      body: params,
    });
  }

  /**
   * Label a field's data sensitivity by hand. A person's label is never overwritten by the server's
   * classifier; `null` withdraws it, so whatever label the classifier wrote shows again. A server
   * without the column drops the key silently, so the label is refused there before the wire.
   * Answers the field with the label it now carries.
   */
  async function setDataSensitivity(
    id: number,
    params: FieldSetDataSensitivityParams,
    options: RequestOptions = {},
  ): Promise<FieldWithDataSensitivity> {
    await transport.requireFeatures(["fieldDataSensitivity"], options);
    return transport.requestParsed(FieldWithDataSensitivity, `/api/field/${id}`, {
      ...options,
      method: "PUT",
      body: params,
    });
  }

  /**
   * Search the values of `searchId` that contain `value`, case-insensitively, answering the
   * matching values of `id` paired with them, ordered by value, at most `limit` of them. An FK on
   * either side is followed to the PK it points at, and a field that resolves to the same field as
   * `searchId` answers each value alone. Without `value`, the first `limit` values. A field with
   * custom display values answers every mapped value with its display value instead, matching
   * `value` against the display value, ignoring both `searchId` and `limit`.
   */
  async function search(
    id: number,
    searchId: number,
    params: FieldSearchParams,
    options: RequestOptions = {},
  ): Promise<FieldSearchMatches> {
    return transport.requestParsed(FieldSearchMatches, `/api/field/${id}/search/${searchId}`, {
      ...options,
      query: { value: params.value, limit: params.limit },
    });
  }

  /**
   * The value of `remappedId` on the one row where `id` equals `value`, as `[value, remapped]`,
   * or `null` when no row matches. For a numeric field the server reads the leading number of
   * `value` and ignores any text after it, refusing only a `value` that has none.
   */
  async function remapping(
    id: number,
    remappedId: number,
    params: FieldRemappingParams,
    options: RequestOptions = {},
  ): Promise<FieldRemappedValue | null> {
    const { features } = await transport.server(options);
    return fetchOptionalParsed(
      transport,
      `/api/field/${id}/remapping/${remappedId}`,
      fieldRemappedValueSchema(features, id === remappedId),
      { ...options, query: { value: params.value } },
    );
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

  return {
    get,
    update,
    setDataSensitivity,
    search,
    remapping,
    summary,
    values,
  };
}
