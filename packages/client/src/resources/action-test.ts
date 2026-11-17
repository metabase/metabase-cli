import { z } from "zod";

import {
  ActionTest,
  type ActionTestCreateInput,
  type ActionTestUpdateInput,
} from "../domain/action-test";
import { TransformTestRunResult } from "../domain/transform-test";
import type { RequestOptions, Transport } from "../http/transport";
import type { ListResult } from "../list";
import { explainer } from "../version/refusal";

// The list answers a bare array, so the count is the array's own length and the server reports none.
const ActionTestList = z.array(ActionTest);

export interface ActionTestListParams {
  "action-id"?: number | undefined;
}

// Every path parameter here is a numeric id, so no fragment needs `encodeURIComponent`.
export function actionTestResource(transport: Transport) {
  const { explain } = explainer(transport, "actionTest");

  /** List the action tests the caller can read, optionally only those of one action. */
  async function list(
    params: ActionTestListParams = {},
    options: RequestOptions = {},
  ): Promise<ListResult<ActionTest>> {
    const data = await transport.requestParsed(ActionTestList, "/api/ee/action-test", {
      ...options,
      query: { "action-id": params["action-id"] },
    });
    return { data, total: null };
  }

  /** Read an action test by id. */
  async function get(id: number, options: RequestOptions = {}): Promise<ActionTest> {
    return transport.requestParsed(ActionTest, `/api/ee/action-test/${id}`, { ...options });
  }

  /**
   * Create an action test. The server validates the inputs and expectations against the action before
   * saving, and refuses with an `HttpError` whose `errorCode` starts with `action-test.`.
   */
  async function create(
    params: ActionTestCreateInput,
    options: RequestOptions = {},
  ): Promise<ActionTest> {
    return transport.requestParsed(ActionTest, "/api/ee/action-test", {
      ...options,
      method: "POST",
      body: params,
    });
  }

  /** Update an action test by id, leaving omitted fields unchanged. */
  async function update(
    id: number,
    params: ActionTestUpdateInput,
    options: RequestOptions = {},
  ): Promise<ActionTest> {
    return transport.requestParsed(ActionTest, `/api/ee/action-test/${id}`, {
      ...options,
      method: "PUT",
      body: params,
    });
  }

  /** Delete an action test by id. */
  async function remove(id: number, options: RequestOptions = {}): Promise<void> {
    await transport.requestRaw(`/api/ee/action-test/${id}`, {
      ...options,
      method: "DELETE",
      expectContentType: "binary",
    });
  }

  /**
   * Run a saved action test by id, in one synchronous request. A result means the run happened: `status`
   * is `passed` or `failed` and every expectation reports what it found. An `HttpError` whose
   * `errorCode` starts with `action-test.` means the run was refused and nothing meaningful ran.
   */
  async function run(id: number, options: RequestOptions = {}): Promise<TransformTestRunResult> {
    return transport.requestParsed(TransformTestRunResult, `/api/ee/action-test/${id}/run`, {
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
