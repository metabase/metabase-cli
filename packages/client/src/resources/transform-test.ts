import { z } from "zod";

import {
  TransformTest,
  type TransformTestCreateInput,
  TransformTestRunResult,
  type TransformTestUpdateInput,
} from "../domain/transform-test";
import type { RequestOptions, Transport } from "../http/transport";
import type { ListResult } from "../list";

// `GET /api/ee/transform-test` answers a bare array rather than a `{ data, total }` envelope, so
// the count a caller reads off `ListResult` is the array's own length and the server reports none.
const TransformTestApiList = z.array(TransformTest);

export interface TransformTestListParams {
  "transform-id"?: number | undefined;
}

// Every path parameter here is a numeric id, so no fragment needs `encodeURIComponent`.
export function transformTestResource(transport: Transport) {
  /** List the transform tests, optionally only those of one transform. */
  async function list(
    params: TransformTestListParams = {},
    options: RequestOptions = {},
  ): Promise<ListResult<TransformTest>> {
    await transport.require("transformTest.list", options);
    const data = await transport.requestParsed(TransformTestApiList, "/api/ee/transform-test", {
      ...options,
      query: { "transform-id": params["transform-id"] },
    });
    return { data, total: null };
  }

  /** Get a transform test by id. */
  async function get(id: number, options: RequestOptions = {}): Promise<TransformTest> {
    await transport.require("transformTest.get", options);
    return transport.requestParsed(TransformTest, `/api/ee/transform-test/${id}`, { ...options });
  }

  /**
   * Create a transform test. The server validates the inputs and expectations against the
   * transform before saving, and refuses with an `HttpError` whose `errorCode` is a
   * `TransformTestRefusalCode` when they cannot run.
   */
  async function create(
    params: TransformTestCreateInput,
    options: RequestOptions = {},
  ): Promise<TransformTest> {
    await transport.require("transformTest.create", options);
    return transport.requestParsed(TransformTest, "/api/ee/transform-test", {
      ...options,
      method: "POST",
      body: params,
    });
  }

  /**
   * Update a transform test by id, leaving omitted fields unchanged. A body that touches the
   * transform, inputs or expectations is validated as on create, with the same refusal.
   */
  async function update(
    id: number,
    params: TransformTestUpdateInput,
    options: RequestOptions = {},
  ): Promise<TransformTest> {
    await transport.require("transformTest.update", options);
    return transport.requestParsed(TransformTest, `/api/ee/transform-test/${id}`, {
      ...options,
      method: "PUT",
      body: params,
    });
  }

  /** Delete a transform test by id. */
  async function remove(id: number, options: RequestOptions = {}): Promise<void> {
    await transport.require("transformTest.delete", options);
    await transport.requestRaw(`/api/ee/transform-test/${id}`, {
      ...options,
      method: "DELETE",
      expectContentType: "binary",
    });
  }

  /**
   * Run a transform test by id. A result means the run happened: `status` is `passed` or `failed`
   * and every expectation reports what it found, one that could not be evaluated as its own
   * `error`. An `HttpError` whose `errorCode` is a `TransformTestRefusalCode` means the run was
   * refused and nothing meaningful ran.
   */
  async function run(id: number, options: RequestOptions = {}): Promise<TransformTestRunResult> {
    await transport.require("transformTest.run", options);
    return transport.requestParsed(TransformTestRunResult, `/api/ee/transform-test/${id}/run`, {
      ...options,
      method: "POST",
    });
  }

  return { list, get, create, update, delete: remove, run };
}
