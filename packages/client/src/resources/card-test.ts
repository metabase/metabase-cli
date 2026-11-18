import { z } from "zod";

import { CardTest, type CardTestCreateInput, type CardTestUpdateInput } from "../domain/card-test";
import { TransformTestRunResult } from "../domain/transform-test";
import type { RequestOptions, Transport } from "../http/transport";
import type { ListResult } from "../list";
import { explainer } from "../version/refusal";

const CardTestApiList = z.array(CardTest);

export interface CardTestListParams {
  "card-id"?: number | undefined;
}

export function cardTestResource(transport: Transport) {
  const { explain } = explainer(transport, "cardTest");

  async function list(
    params: CardTestListParams = {},
    options: RequestOptions = {},
  ): Promise<ListResult<CardTest>> {
    const data = await transport.requestParsed(CardTestApiList, "/api/ee/card-test", {
      ...options,
      query: { "card-id": params["card-id"] },
    });
    return { data, total: null };
  }

  async function get(id: number, options: RequestOptions = {}): Promise<CardTest> {
    return transport.requestParsed(CardTest, `/api/ee/card-test/${id}`, { ...options });
  }

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

  async function remove(id: number, options: RequestOptions = {}): Promise<void> {
    await transport.requestRaw(`/api/ee/card-test/${id}`, {
      ...options,
      method: "DELETE",
      expectContentType: "binary",
    });
  }

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
