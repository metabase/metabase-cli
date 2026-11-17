import { z } from "zod";

import { CardTest, type CardTestCreateInput, type CardTestUpdateInput } from "../domain/card-test";
import { TransformTestRunResult } from "../domain/transform-test";
import type { RequestOptions, Transport } from "../http/transport";
import type { ListResult } from "../list";
import { explainer } from "../version/refusal";

// The list answers a bare array, so the count is the array's own length and the server reports none.
const CardTestList = z.array(CardTest);

export interface CardTestListParams {
  "card-id"?: number | undefined;
}

// Every path parameter here is a numeric id, so no fragment needs `encodeURIComponent`.
export function cardTestResource(transport: Transport) {
  const { explain } = explainer(transport, "cardTest");

  /** List the card tests the caller can read, optionally only those of one card. */
  async function list(
    params: CardTestListParams = {},
    options: RequestOptions = {},
  ): Promise<ListResult<CardTest>> {
    const data = await transport.requestParsed(CardTestList, "/api/ee/card-test", {
      ...options,
      query: { "card-id": params["card-id"] },
    });
    return { data, total: null };
  }

  /** Read a card test by id. */
  async function get(id: number, options: RequestOptions = {}): Promise<CardTest> {
    return transport.requestParsed(CardTest, `/api/ee/card-test/${id}`, { ...options });
  }

  /**
   * Create a card test. The server validates the inputs and expectations against the card before
   * saving, and refuses with an `HttpError` whose `errorCode` starts with `card-test.`.
   */
  async function create(
    params: CardTestCreateInput,
    options: RequestOptions = {},
  ): Promise<CardTest> {
    return transport.requestParsed(CardTest, "/api/ee/card-test", {
      ...options,
      method: "POST",
      body: params,
    });
  }

  /** Update a card test by id, leaving omitted fields unchanged. */
  async function update(
    id: number,
    params: CardTestUpdateInput,
    options: RequestOptions = {},
  ): Promise<CardTest> {
    return transport.requestParsed(CardTest, `/api/ee/card-test/${id}`, {
      ...options,
      method: "PUT",
      body: params,
    });
  }

  /** Delete a card test by id. */
  async function remove(id: number, options: RequestOptions = {}): Promise<void> {
    await transport.requestRaw(`/api/ee/card-test/${id}`, {
      ...options,
      method: "DELETE",
      expectContentType: "binary",
    });
  }

  /**
   * Run a saved card test by id, in one synchronous request. A result means the run happened: `status`
   * is `passed` or `failed` and every expectation reports what it found. An `HttpError` whose
   * `errorCode` starts with `card-test.` means the run was refused and nothing meaningful ran.
   */
  async function run(id: number, options: RequestOptions = {}): Promise<TransformTestRunResult> {
    return transport.requestParsed(TransformTestRunResult, `/api/ee/card-test/${id}/run`, {
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
