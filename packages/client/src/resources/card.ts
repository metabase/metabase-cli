import { z } from "zod";

import {
  Card,
  type CardCreateInput,
  type CardListFilter,
  CardQueryResult,
  type CardUpdateInput,
} from "../domain/card";
import { QueryMetadata } from "../domain/dataset";
import type { ExportFormat } from "../domain/query";
import type { RequestOptions, Transport } from "../http/transport";
import type { ListResult } from "../list";
import { assertPivotedExport } from "./pivot-export";

// `GET /api/card` answers a bare array rather than a `{ data, total }` envelope, so the count a
// caller reads off `ListResult` is the array's own length and the server reports none.
const CardApiList = z.array(Card);

export interface CardListParams {
  f?: CardListFilter | undefined;
  model_id?: string | undefined;
}

export interface CardQueryParams {
  parameters: unknown[];
}

export interface CardExportParams {
  parameters: unknown[];
  format_rows: boolean;
  pivot_results: boolean;
  csv_include_bom: boolean;
}

export function cardResource(transport: Transport) {
  /** List cards. `f` picks a server-side preset; `model_id` scopes the presets that need an id. */
  async function list(
    params: CardListParams = {},
    options: RequestOptions = {},
  ): Promise<ListResult<Card>> {
    const data = await transport.requestParsed(CardApiList, "/api/card", {
      ...options,
      query: { f: params.f, model_id: params.model_id },
    });
    return { data, total: null };
  }

  /** Get one card by id. */
  async function get(id: number, options: RequestOptions = {}): Promise<Card> {
    return transport.requestParsed(Card, `/api/card/${id}`, { ...options });
  }

  /** Create a card — a question, a model, or a metric — from a full card body. */
  async function create(params: CardCreateInput, options: RequestOptions = {}): Promise<Card> {
    return transport.requestParsed(Card, "/api/card", {
      ...options,
      method: "POST",
      body: params,
    });
  }

  /** Update a card by id, patching only the fields the body carries. */
  async function update(
    id: number,
    params: CardUpdateInput,
    options: RequestOptions = {},
  ): Promise<Card> {
    return transport.requestParsed(Card, `/api/card/${id}`, {
      ...options,
      method: "PUT",
      body: params,
    });
  }

  /** Archive (soft-delete) a card by id. Metabase models this as an update, not its own endpoint. */
  async function archive(id: number, options: RequestOptions = {}): Promise<Card> {
    return update(id, { archived: true }, options);
  }

  /** Run a saved card and return the query result envelope. */
  async function query(
    id: number,
    params: CardQueryParams,
    options: RequestOptions = {},
  ): Promise<CardQueryResult> {
    return transport.requestParsed(CardQueryResult, `/api/card/${id}/query`, {
      ...options,
      method: "POST",
      body: { parameters: params.parameters },
    });
  }

  /**
   * Run the query associated with a Card, and return its results as a file in the specified
   * format. Unlike `query`, this endpoint takes a form-encoded body and answers bytes, so a caller
   * consumes the stream rather than a value. A pivot the server would answer with plain rows (a
   * JSON export, or pivoted exports turned off) is refused. `csv_include_bom` opens a CSV with a
   * UTF-8 byte order mark; a server without it drops the key silently, so asking for one is refused
   * there before the wire.
   */
  async function exportQuery(
    id: number,
    format: ExportFormat,
    params: CardExportParams,
    options: RequestOptions = {},
  ): Promise<ReadableStream<Uint8Array>> {
    if (params.pivot_results) {
      await assertPivotedExport(transport, format, options);
    }
    await transport.requireFeatures(
      params.csv_include_bom ? ["exportCsvByteOrderMark"] : [],
      options,
    );
    const body = new URLSearchParams({
      parameters: JSON.stringify(params.parameters),
      format_rows: String(params.format_rows),
      pivot_results: String(params.pivot_results),
      csv_include_bom: String(params.csv_include_bom),
    });
    return transport.requestStream(`/api/card/${id}/query/${format}`, {
      ...options,
      method: "POST",
      body,
    });
  }

  /**
   * Get all of the required query metadata for a saved card: the databases, tables, fields and
   * snippets its query references, plus the card's own metadata for a model or a native query.
   */
  async function queryMetadata(id: number, options: RequestOptions = {}): Promise<QueryMetadata> {
    return transport.requestParsed(QueryMetadata, `/api/card/${id}/query_metadata`, {
      ...options,
    });
  }

  return { list, get, create, update, archive, query, exportQuery, queryMetadata };
}
