import { z } from "zod";

import {
  MeasureTest,
  type MeasureTestCreateInput,
  type MeasureTestUpdateInput,
} from "../domain/measure-test";
import { TransformTestRunResult } from "../domain/transform-test";
import type { RequestOptions, Transport } from "../http/transport";
import type { ListResult } from "../list";
import { explainer } from "../version/refusal";

// The list answers a bare array, so the count is the array's own length and the server reports none.
const MeasureTestList = z.array(MeasureTest);

export interface MeasureTestListParams {
  "measure-id"?: number | undefined;
}

// Every path parameter here is a numeric id, so no fragment needs `encodeURIComponent`.
export function measureTestResource(transport: Transport) {
  const { explain } = explainer(transport, "measureTest");

  /** List the measure tests the caller can read, optionally only those of one measure. */
  async function list(
    params: MeasureTestListParams = {},
    options: RequestOptions = {},
  ): Promise<ListResult<MeasureTest>> {
    const data = await transport.requestParsed(MeasureTestList, "/api/ee/measure-test", {
      ...options,
      query: { "measure-id": params["measure-id"] },
    });
    return { data, total: null };
  }

  /** Read a measure test by id. */
  async function get(id: number, options: RequestOptions = {}): Promise<MeasureTest> {
    return transport.requestParsed(MeasureTest, `/api/ee/measure-test/${id}`, { ...options });
  }

  /**
   * Create a measure test. The server validates the inputs and expectations against the measure before
   * saving, and refuses with an `HttpError` whose `errorCode` starts with `measure-test.`.
   */
  async function create(
    params: MeasureTestCreateInput,
    options: RequestOptions = {},
  ): Promise<MeasureTest> {
    return transport.requestParsed(MeasureTest, "/api/ee/measure-test", {
      ...options,
      method: "POST",
      body: params,
    });
  }

  /** Update a measure test by id, leaving omitted fields unchanged. */
  async function update(
    id: number,
    params: MeasureTestUpdateInput,
    options: RequestOptions = {},
  ): Promise<MeasureTest> {
    return transport.requestParsed(MeasureTest, `/api/ee/measure-test/${id}`, {
      ...options,
      method: "PUT",
      body: params,
    });
  }

  /** Delete a measure test by id. */
  async function remove(id: number, options: RequestOptions = {}): Promise<void> {
    await transport.requestRaw(`/api/ee/measure-test/${id}`, {
      ...options,
      method: "DELETE",
      expectContentType: "binary",
    });
  }

  /**
   * Run a saved measure test by id, in one synchronous request. A result means the run happened: `status`
   * is `passed` or `failed` and every expectation reports what it found. An `HttpError` whose
   * `errorCode` starts with `measure-test.` means the run was refused and nothing meaningful ran.
   */
  async function run(id: number, options: RequestOptions = {}): Promise<TransformTestRunResult> {
    return transport.requestParsed(TransformTestRunResult, `/api/ee/measure-test/${id}/run`, {
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
