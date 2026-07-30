import { z } from "zod";

import { TestRunInput, TestRunResult, type TestRunTargetType } from "../domain/transform-test-run";
import type { RequestOptions, Transport } from "../http/transport";
import type { ListResult } from "../list";

import type { CsvFile } from "./csv-upload";

// The inputs endpoint answers a bare array, so the count a caller reads off `ListResult` is the
// array's own length and the server reports none.
const TestRunInputApiList = z.array(TestRunInput);

export type TestRunAssertionSeverity = "error" | "warn";

// A SQL check the server runs against the target's output; it passes iff it returns zero rows.
export interface TestRunAssertion {
  name: string;
  sql: string;
  severity: TestRunAssertionSeverity;
}

export interface TestRunFixture {
  table_id: number;
  file: CsvFile;
}

export interface TestRunInputsParams {
  sources: number[];
}

export interface TestRunParams {
  sources: number[];
  inputs: TestRunFixture[];
  expected?: CsvFile;
  ignore_columns: string[];
  assertions: TestRunAssertion[];
}

export function buildTestRunFormData(params: TestRunParams): FormData {
  const form = new FormData();
  for (const { table_id, file } of params.inputs) {
    form.append(`input-${table_id}`, new Blob([file.bytes]), file.filename);
  }
  if (params.expected !== undefined) {
    form.append("expected", new Blob([params.expected.bytes]), params.expected.filename);
  }
  if (params.sources.length > 0) {
    form.append("sources", JSON.stringify(params.sources));
  }
  if (params.ignore_columns.length > 0) {
    form.append("options", JSON.stringify({ ignore_columns: params.ignore_columns }));
  }
  if (params.assertions.length > 0) {
    form.append("assertions", JSON.stringify(params.assertions));
  }
  return form;
}

// Every path parameter here is a target-type enum member or a numeric id, so no fragment needs
// `encodeURIComponent`.
export function transformTestResource(transport: Transport) {
  /**
   * List the boundary input tables of the sub-graph from `sources` up to the target — the tables a
   * test run requires one fixture CSV each for.
   */
  async function inputs(
    targetType: TestRunTargetType,
    target: number,
    params: TestRunInputsParams,
    options: RequestOptions = {},
  ): Promise<ListResult<TestRunInput>> {
    const data = await transport.requestParsed(
      TestRunInputApiList,
      `/api/ee/transform-test/${targetType}/${target}/inputs`,
      { ...options, query: { sources: params.sources } },
    );
    return { data, total: null };
  }

  /**
   * Test-run the sub-graph from `sources` up to the target against fixture CSVs, checking the
   * target's output against the expected CSV and/or SQL assertions. Real tables are never touched.
   */
  async function run(
    targetType: TestRunTargetType,
    target: number,
    params: TestRunParams,
    options: RequestOptions = {},
  ): Promise<TestRunResult> {
    return transport.requestParsed(
      TestRunResult,
      `/api/ee/transform-test/${targetType}/${target}/run`,
      { ...options, method: "POST", body: buildTestRunFormData(params) },
    );
  }

  return { inputs, run };
}
