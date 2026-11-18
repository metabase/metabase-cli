import { z } from "zod";

import { DataTestRun, type DataTestRunStatus, type DataTestType } from "../domain/data-test";
import type { RequestOptions, Transport } from "../http/transport";
import { explainer } from "../version/refusal";

const DataTestRunApiPage = z
  .object({
    data: z.array(DataTestRun),
    total: z.number().int(),
  })
  .loose();

export interface DataTestRunPage {
  data: DataTestRun[];
  total: number;
}

export interface DataTestRunListParams {
  "test-type": DataTestType;
  "test-id"?: number | undefined;
  statuses?: DataTestRunStatus[] | undefined;
  "start-time"?: string | undefined;
  "end-time"?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export function dataTestRunResource(transport: Transport) {
  const { explain } = explainer(transport, "dataTestRun");

  async function list(
    params: DataTestRunListParams,
    options: RequestOptions = {},
  ): Promise<DataTestRunPage> {
    const page = await transport.requestParsed(DataTestRunApiPage, "/api/ee/data-test-run", {
      ...options,
      query: { ...params },
    });
    return { data: page.data, total: page.total };
  }

  return {
    list: explain("list", list),
  };
}
