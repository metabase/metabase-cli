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

const SegmentTestApiList = z.array(SegmentTest);

export interface SegmentTestListParams {
  "segment-id"?: number | undefined;
}

export function segmentTestResource(transport: Transport) {
  const { explain } = explainer(transport, "segmentTest");

  async function list(
    params: SegmentTestListParams = {},
    options: RequestOptions = {},
  ): Promise<ListResult<SegmentTest>> {
    const data = await transport.requestParsed(SegmentTestApiList, "/api/ee/segment-test", {
      ...options,
      query: { "segment-id": params["segment-id"] },
    });
    return { data, total: null };
  }

  async function get(id: number, options: RequestOptions = {}): Promise<SegmentTest> {
    return transport.requestParsed(SegmentTest, `/api/ee/segment-test/${id}`, { ...options });
  }

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

  async function remove(id: number, options: RequestOptions = {}): Promise<void> {
    await transport.requestRaw(`/api/ee/segment-test/${id}`, {
      ...options,
      method: "DELETE",
      expectContentType: "binary",
    });
  }

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
