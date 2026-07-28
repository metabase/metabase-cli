import { z } from "zod";

import {
  TransformIndex,
  type TransformIndexCreateInput,
  TransformIndexRequest,
  type TransformIndexUpdateInput,
} from "../domain/transform-index";
import type { RequestOptions, Transport } from "../http/transport";
import type { ListResult } from "../list";

// `GET /api/index` wraps its rows in a `{ data }` envelope carrying no count, so the count a
// caller reads off `ListResult` is the array's own length and the server reports none.
const TransformIndexApiList = z.object({ data: z.array(TransformIndex) }).loose();

// Every path parameter here is a numeric id, so no fragment needs `encodeURIComponent`.
export function transformIndexResource(transport: Transport) {
  /**
   * List the indexes on a transform's target table: those observed in the warehouse, merged with
   * the index requests Metabase manages for it.
   */
  async function list(
    transformId: number,
    options: RequestOptions = {},
  ): Promise<ListResult<TransformIndex>> {
    const { data } = await transport.requestParsed(TransformIndexApiList, "/api/index", {
      ...options,
      query: { "transform-id": transformId },
    });
    return { data, total: null };
  }

  /** Get one index request by id. */
  async function get(id: number, options: RequestOptions = {}): Promise<TransformIndexRequest> {
    return transport.requestParsed(TransformIndexRequest, `/api/index/request/${id}`, {
      ...options,
    });
  }

  /**
   * Request an index on a transform's target table. The request lands pending; the physical index
   * is created the next time the target table is rebuilt in full.
   */
  async function create(
    params: TransformIndexCreateInput,
    options: RequestOptions = {},
  ): Promise<TransformIndexRequest> {
    return transport.requestParsed(TransformIndexRequest, "/api/index/request", {
      ...options,
      method: "POST",
      body: params,
    });
  }

  /**
   * Replace an index request's definition by id. The name, kind and type are fixed at creation —
   * changing those means deleting the request and creating another.
   */
  async function update(
    id: number,
    params: TransformIndexUpdateInput,
    options: RequestOptions = {},
  ): Promise<TransformIndexRequest> {
    return transport.requestParsed(TransformIndexRequest, `/api/index/request/${id}`, {
      ...options,
      method: "PUT",
      body: params,
    });
  }

  /** Mark an index request for deletion by id; the physical index drops on the next full rebuild. */
  async function remove(id: number, options: RequestOptions = {}): Promise<void> {
    await transport.requestRaw(`/api/index/request/${id}`, {
      ...options,
      method: "DELETE",
      expectContentType: "binary",
    });
  }

  return { list, get, create, update, delete: remove };
}
