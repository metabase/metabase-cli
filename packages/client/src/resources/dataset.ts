import { CardQueryResult } from "../domain/card";
import { CompiledQuery, QueryMetadata } from "../domain/dataset";
import type { DatasetQuery, ExportFormat, VisualizationSettings } from "../domain/query";
import type { RequestOptions, Transport } from "../http/transport";
import { assertPivotedExport } from "./pivot-export";

export interface DatasetNativeParams {
  pretty?: boolean | undefined;
}

export interface DatasetExportParams {
  query: DatasetQuery;
  visualization_settings?: VisualizationSettings | undefined;
  format_rows: boolean;
  pivot_results: boolean;
  csv_include_bom: boolean;
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
   * Execute a query and download the result data as a file in the specified format. Unlike
   * `query`, this endpoint answers bytes, so a caller consumes the stream rather than a value.
   * `visualization_settings` drive `format_rows` column formatting and, through
   * `pivot_table.column_split`, the layout `pivot_results` lays the rows out in. The server only
   * computes that layout for a query it runs as a pivot, which it reads from the query's own
   * `was-pivot`, so `pivot_results` sets it. A pivot the server would answer with plain rows (a
   * JSON export, or pivoted exports turned off) is refused. `csv_include_bom` opens a CSV with a
   * UTF-8 byte order mark; a server without it drops the key silently, so asking for one is refused
   * there before the wire.
   */
  async function exportQuery(
    format: ExportFormat,
    params: DatasetExportParams,
    options: RequestOptions = {},
  ): Promise<ReadableStream<Uint8Array>> {
    await transport.require("dataset.exportQuery", options);
    await transport.requireFeatures(
      params.csv_include_bom ? ["exportCsvByteOrderMark"] : [],
      options,
    );
    if (params.pivot_results) {
      await assertPivotedExport(transport, format, options);
    }
    const exported = params.pivot_results ? { ...params.query, "was-pivot": true } : params.query;
    return transport.requestStream(`/api/dataset/${format}`, {
      ...options,
      method: "POST",
      body: {
        query: exported,
        visualization_settings: params.visualization_settings,
        format_rows: params.format_rows,
        pivot_results: params.pivot_results,
        csv_include_bom: params.csv_include_bom,
      },
    });
  }

  return { query, native, queryMetadata, exportQuery };
}
