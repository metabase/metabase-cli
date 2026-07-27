import { z } from "zod";

import {
  Card,
  type CardCreateInput,
  type CardExportFormat,
  type CardListFilter,
  CardQueryResult,
  type CardUpdateInput,
} from "../domain/card";
import type { RequestOptions, Transport } from "../http/transport";
import type { ListResult } from "../list";

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
   * Run a saved card and stream its result as a download. Unlike `query`, this endpoint takes a
   * form-encoded body and answers bytes, so a caller consumes the stream rather than a value.
   */
  async function exportQuery(
    id: number,
    format: CardExportFormat,
    params: CardExportParams,
    options: RequestOptions = {},
  ): Promise<ReadableStream<Uint8Array>> {
    const body = new URLSearchParams({
      parameters: JSON.stringify(params.parameters),
      format_rows: String(params.format_rows),
      pivot_results: String(params.pivot_results),
    });
    return transport.requestStream(`/api/card/${id}/query/${format}`, {
      ...options,
      method: "POST",
      body,
    });
  }

  return { list, get, create, update, archive, query, exportQuery };
}
