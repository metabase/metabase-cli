import { z } from "zod";

import {
  TransformTest,
  type TransformTestCreateInput,
  TransformTestRunResult,
  type TransformTestUpdateInput,
} from "../domain/transform-test";
import type { RequestOptions, Transport } from "../http/transport";
import type { ListResult } from "../list";

// `GET /api/transform-test` answers a bare array rather than a `{ data, total }` envelope, so the
// count a caller reads off `ListResult` is the array's own length and the server reports none.
const TransformTestApiList = z.array(TransformTest);

export interface TransformTestListParams {
  "transform-id"?: number | undefined;
}

// Every path parameter here is a numeric id, so no fragment needs `encodeURIComponent`.
export function transformTestResource(transport: Transport) {
  /** List the transform tests the caller can see, optionally only those of one transform. */
  async function list(
    params: TransformTestListParams = {},
    options: RequestOptions = {},
  ): Promise<ListResult<TransformTest>> {
    const data = await transport.requestParsed(TransformTestApiList, "/api/transform-test", {
      ...options,
      query: { "transform-id": params["transform-id"] },
    });
    return { data, total: null };
  }

  /** Get one transform test by id. */
  async function get(id: number, options: RequestOptions = {}): Promise<TransformTest> {
    return transport.requestParsed(TransformTest, `/api/transform-test/${id}`, { ...options });
  }

  /** Create a transform test — the inputs standing in for the transform's source tables, and the expectations checked against its output. */
  async function create(
    params: TransformTestCreateInput,
    options: RequestOptions = {},
  ): Promise<TransformTest> {
    return transport.requestParsed(TransformTest, "/api/transform-test", {
      ...options,
      method: "POST",
      body: params,
    });
  }

  /** Update a transform test by id, patching only the fields the body carries. */
  async function update(
    id: number,
    params: TransformTestUpdateInput,
    options: RequestOptions = {},
  ): Promise<TransformTest> {
    return transport.requestParsed(TransformTest, `/api/transform-test/${id}`, {
      ...options,
      method: "PUT",
      body: params,
    });
  }

  /** Delete a transform test by id. */
  async function remove(id: number, options: RequestOptions = {}): Promise<void> {
    await transport.requestRaw(`/api/transform-test/${id}`, {
      ...options,
      method: "DELETE",
      expectContentType: "binary",
    });
  }

  /**
   * Run a transform test against temp tables and report what each expectation found. The transform
   * itself never runs against real tables, and a failing expectation is a result rather than an
   * error.
   */
  async function run(id: number, options: RequestOptions = {}): Promise<TransformTestRunResult> {
    return transport.requestParsed(TransformTestRunResult, `/api/transform-test/${id}/run`, {
      ...options,
      method: "POST",
    });
  }

  return { list, get, create, update, delete: remove, run };
}
