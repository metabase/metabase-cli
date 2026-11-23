import { z } from "zod";

import {
  TestSuite,
  type TestSuiteCreateInput,
  TestSuiteRun,
  type TestSuiteUpdateInput,
} from "../domain/test-suite";
import type { RequestOptions, Transport } from "../http/transport";
import type { ListResult } from "../list";
import { explainer } from "../version/refusal";

const TestSuiteList = z.array(TestSuite);

const TEST_SUITE_PATH = "/api/ee/data-test-suite";

// Every path parameter here is a numeric id, so no fragment needs `encodeURIComponent`.
export function testSuiteResource(transport: Transport) {
  const { explain } = explainer(transport, "testSuite");

  /** List the test suites the caller can read. */
  async function list(options: RequestOptions = {}): Promise<ListResult<TestSuite>> {
    const data = await transport.requestParsed(TestSuiteList, TEST_SUITE_PATH, { ...options });
    return { data, total: null };
  }

  /** Read a test suite by id. */
  async function get(id: number, options: RequestOptions = {}): Promise<TestSuite> {
    return transport.requestParsed(TestSuite, `${TEST_SUITE_PATH}/${id}`, { ...options });
  }

  /** Create a test suite from the tests it names. */
  async function create(
    params: TestSuiteCreateInput,
    options: RequestOptions = {},
  ): Promise<TestSuite> {
    return transport.requestParsed(TestSuite, TEST_SUITE_PATH, {
      ...options,
      method: "POST",
      body: params,
    });
  }

  /** Update a test suite by id, leaving omitted fields unchanged; `tests` replaces the members. */
  async function update(
    id: number,
    params: TestSuiteUpdateInput,
    options: RequestOptions = {},
  ): Promise<TestSuite> {
    return transport.requestParsed(TestSuite, `${TEST_SUITE_PATH}/${id}`, {
      ...options,
      method: "PUT",
      body: params,
    });
  }

  /** Delete a test suite by id. The tests it names are kept. */
  async function remove(id: number, options: RequestOptions = {}): Promise<void> {
    await transport.requestRaw(`${TEST_SUITE_PATH}/${id}`, {
      ...options,
      method: "DELETE",
      expectContentType: "binary",
    });
  }

  /** Run every test in a suite by id, in one synchronous request, answering each test's result. */
  async function run(id: number, options: RequestOptions = {}): Promise<TestSuiteRun> {
    return transport.requestParsed(TestSuiteRun, `${TEST_SUITE_PATH}/${id}/run`, {
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
