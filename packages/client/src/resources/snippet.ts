import { z } from "zod";

import { Snippet, type SnippetCreateInput, type SnippetUpdateInput } from "../domain/snippet";
import type { RequestOptions, Transport } from "../http/transport";
import type { ListResult } from "../list";

// `GET /api/native-query-snippet` answers a bare array rather than a `{ data, total }` envelope, so
// the count a caller reads off `ListResult` is the array's own length and the server reports none.
const SnippetApiList = z.array(Snippet);

export interface SnippetListParams {
  archived?: boolean | undefined;
}

export function snippetResource(transport: Transport) {
  /** List native query snippets. `archived` swaps the listing to archived snippets. */
  async function list(
    params: SnippetListParams = {},
    options: RequestOptions = {},
  ): Promise<ListResult<Snippet>> {
    const data = await transport.requestParsed(SnippetApiList, "/api/native-query-snippet", {
      ...options,
      query: { archived: params.archived },
    });
    return { data, total: null };
  }

  /** Get one native query snippet by id. */
  async function get(id: number, options: RequestOptions = {}): Promise<Snippet> {
    return transport.requestParsed(Snippet, `/api/native-query-snippet/${id}`, { ...options });
  }

  /** Create a native query snippet from a name, its SQL fragment, and an optional collection. */
  async function create(
    params: SnippetCreateInput,
    options: RequestOptions = {},
  ): Promise<Snippet> {
    return transport.requestParsed(Snippet, "/api/native-query-snippet", {
      ...options,
      method: "POST",
      body: params,
    });
  }

  /** Update a native query snippet by id, patching only the fields the body carries. */
  async function update(
    id: number,
    params: SnippetUpdateInput,
    options: RequestOptions = {},
  ): Promise<Snippet> {
    return transport.requestParsed(Snippet, `/api/native-query-snippet/${id}`, {
      ...options,
      method: "PUT",
      body: params,
    });
  }

  /**
   * Archive (soft-delete) a native query snippet by id. Metabase models this as an update, not its
   * own endpoint.
   */
  async function archive(id: number, options: RequestOptions = {}): Promise<Snippet> {
    return update(id, { archived: true }, options);
  }

  return { list, get, create, update, archive };
}
