import { z } from "zod";

import {
  TransformTag,
  type TransformTagCreateInput,
  type TransformTagUpdateInput,
} from "../domain/transform-tag";
import type { RequestOptions, Transport } from "../http/transport";
import type { ListResult } from "../list";

// `GET /api/transform-tag` answers a bare array rather than a `{ data, total }` envelope, so the
// count a caller reads off `ListResult` is the array's own length and the server reports none.
const TransformTagApiList = z.array(TransformTag);

// Every path parameter here is a numeric id, so no fragment needs `encodeURIComponent`.
export function transformTagResource(transport: Transport) {
  /** List every transform tag the caller can see, built-in tags included. */
  async function list(options: RequestOptions = {}): Promise<ListResult<TransformTag>> {
    const data = await transport.requestParsed(TransformTagApiList, "/api/transform-tag", {
      ...options,
    });
    return { data, total: null };
  }

  /** Create a transform tag, the label a transform job matches transforms on. */
  async function create(
    params: TransformTagCreateInput,
    options: RequestOptions = {},
  ): Promise<TransformTag> {
    return transport.requestParsed(TransformTag, "/api/transform-tag", {
      ...options,
      method: "POST",
      body: params,
    });
  }

  /** Rename a transform tag by id. */
  async function update(
    id: number,
    params: TransformTagUpdateInput,
    options: RequestOptions = {},
  ): Promise<TransformTag> {
    return transport.requestParsed(TransformTag, `/api/transform-tag/${id}`, {
      ...options,
      method: "PUT",
      body: params,
    });
  }

  /** Delete a transform tag by id, detaching it from every transform and job carrying it. */
  async function remove(id: number, options: RequestOptions = {}): Promise<void> {
    await transport.requestRaw(`/api/transform-tag/${id}`, {
      ...options,
      method: "DELETE",
      expectContentType: "binary",
    });
  }

  return { list, create, update, delete: remove };
}
