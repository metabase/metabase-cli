import { CardQueryResult } from "../domain/card";
import { CompiledQuery, QueryMetadata } from "../domain/dataset";
import type { DatasetQuery, ExportFormat } from "../domain/query";
import type { RequestOptions, Transport } from "../http/transport";

export interface DatasetNativeParams {
  pretty?: boolean | undefined;
}

export interface DatasetExportParams {
  query: DatasetQuery;
  format_rows: boolean;
  pivot_results: boolean;
}

export function datasetResource(transport: Transport) {
  /**
   * Run an ad-hoc query and return its result envelope. The body is a whole query — MBQL 5, legacy
   * MBQL, or native — rather than a reference to a saved one, so nothing here is a card.
   */
  async function query(body: unknown, options: RequestOptions = {}): Promise<CardQueryResult> {
    await transport.require("dataset.query", options);
    return transport.requestParsed(CardQueryResult, "/api/dataset", {
      ...options,
      method: "POST",
      body,
    });
  }

  /**
   * Fetch a native version of an MBQL query. `pretty` rides in the same body as the query and
   * defaults server-side to true.
   */
  async function native(
    datasetQuery: DatasetQuery,
    params: DatasetNativeParams = {},
    options: RequestOptions = {},
  ): Promise<CompiledQuery> {
    await transport.require("dataset.native", options);
    return transport.requestParsed(CompiledQuery, "/api/dataset/native", {
      ...options,
      method: "POST",
      body: { ...datasetQuery, pretty: params.pretty },
    });
  }

  /**
   * Get all of the required query metadata for an ad-hoc query: the databases, tables, fields and
   * snippets it references. `{ settings: { "include-sensitive-fields": true } }` inside the query
   * widens the field filter.
   */
  async function queryMetadata(
    datasetQuery: DatasetQuery,
    options: RequestOptions = {},
  ): Promise<QueryMetadata> {
    await transport.require("dataset.queryMetadata", options);
    return transport.requestParsed(QueryMetadata, "/api/dataset/query_metadata", {
      ...options,
      method: "POST",
      body: datasetQuery,
    });
  }

  /**
   * Run an ad-hoc query and stream its result as a download. Unlike `query`, this endpoint answers
   * bytes, so a caller consumes the stream rather than a value.
   */
  async function exportQuery(
    format: ExportFormat,
    params: DatasetExportParams,
    options: RequestOptions = {},
  ): Promise<ReadableStream<Uint8Array>> {
    await transport.require("dataset.exportQuery", options);
    return transport.requestStream(`/api/dataset/${format}`, {
      ...options,
      method: "POST",
      body: {
        query: params.query,
        format_rows: params.format_rows,
        pivot_results: params.pivot_results,
      },
    });
  }

  return { query, native, queryMetadata, exportQuery };
}
