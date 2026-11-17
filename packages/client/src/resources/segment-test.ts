import { z } from "zod";

import {
  SegmentTest,
  type SegmentTestCreateInput,
  type SegmentTestUpdateInput,
} from "../domain/segment-test";
import { TransformTestRunResult } from "../domain/transform-test";
import type { RequestOptions, Transport } from "../http/transport";
import type { ListResult } from "../list";
import { explainer } from "../version/refusal";

// The list answers a bare array, so the count is the array's own length and the server reports none.
const SegmentTestList = z.array(SegmentTest);

export interface SegmentTestListParams {
  "segment-id"?: number | undefined;
}

// Every path parameter here is a numeric id, so no fragment needs `encodeURIComponent`.
export function segmentTestResource(transport: Transport) {
  const { explain } = explainer(transport, "segmentTest");

  /** List the segment tests the caller can read, optionally only those of one segment. */
  async function list(
    params: SegmentTestListParams = {},
    options: RequestOptions = {},
  ): Promise<ListResult<SegmentTest>> {
    const data = await transport.requestParsed(SegmentTestList, "/api/ee/segment-test", {
      ...options,
      query: { "segment-id": params["segment-id"] },
    });
    return { data, total: null };
  }

  /** Read a segment test by id. */
  async function get(id: number, options: RequestOptions = {}): Promise<SegmentTest> {
    return transport.requestParsed(SegmentTest, `/api/ee/segment-test/${id}`, { ...options });
  }

  /**
   * Create a segment test. The server validates the inputs and expectations against the segment before
   * saving, and refuses with an `HttpError` whose `errorCode` starts with `segment-test.`.
   */
  async function create(
    params: SegmentTestCreateInput,
    options: RequestOptions = {},
  ): Promise<SegmentTest> {
    return transport.requestParsed(SegmentTest, "/api/ee/segment-test", {
      ...options,
      method: "POST",
      body: params,
    });
  }

  /** Update a segment test by id, leaving omitted fields unchanged. */
  async function update(
    id: number,
    params: SegmentTestUpdateInput,
    options: RequestOptions = {},
  ): Promise<SegmentTest> {
    return transport.requestParsed(SegmentTest, `/api/ee/segment-test/${id}`, {
      ...options,
      method: "PUT",
      body: params,
    });
  }

  /** Delete a segment test by id. */
  async function remove(id: number, options: RequestOptions = {}): Promise<void> {
    await transport.requestRaw(`/api/ee/segment-test/${id}`, {
      ...options,
      method: "DELETE",
      expectContentType: "binary",
    });
  }

  /**
   * Run a saved segment test by id, in one synchronous request. A result means the run happened: `status`
   * is `passed` or `failed` and every expectation reports what it found. An `HttpError` whose
   * `errorCode` starts with `segment-test.` means the run was refused and nothing meaningful ran.
   */
  async function run(id: number, options: RequestOptions = {}): Promise<TransformTestRunResult> {
    return transport.requestParsed(TransformTestRunResult, `/api/ee/segment-test/${id}/run`, {
      ...options,
      method: "POST",
    });
  }

  return {
    list: explain("list", list),
    get: explain("get", get),
    create: explain("create", create),
    update: explain("update", update),
    delete: explain("delete", remove),
    run: explain("run", run),
  };
}
