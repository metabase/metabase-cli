import { z } from "zod";

import {
  TestSuite,
  type TestSuiteCreateInput,
  TestSuiteRun,
  TestSuiteRunRecord,
  type TestSuiteUpdateInput,
} from "../domain/test-suite";
import type { RequestOptions, Transport } from "../http/transport";
import type { ListResult } from "../list";
import { type Page, type PaginateOptions, paginatePages } from "../paginate";
import { explainer } from "../version/refusal";

const TestSuiteList = z.array(TestSuite);

const TEST_SUITE_PATH = "/api/ee/test-suite";

export type TestSuiteRunPageOptions = Omit<PaginateOptions, "query">;

// Every path parameter here is a numeric id, so no fragment needs `encodeURIComponent`.
export function testSuiteResource(transport: Transport) {
  const { explain, explainWalk } = explainer(transport, "testSuite");

  /**
   * List the test suites, in name order, with their members. A member's `status` is `readable`,
   * `unreadable` when the caller cannot read its test, or `missing` when this instance lacks the
   * test; only a `readable` member has `test_id` and `name`.
   */
  async function list(options: RequestOptions = {}): Promise<ListResult<TestSuite>> {
    const data = await transport.requestParsed(TestSuiteList, TEST_SUITE_PATH, { ...options });
    return { data, total: null };
  }

  /**
   * Get a test suite with its members. A member's `status` is `readable`, `unreadable` when the
   * caller cannot read its test, or `missing` when this instance lacks the test; only a `readable`
   * member has `test_id` and `name`.
   */
  async function get(id: number, options: RequestOptions = {}): Promise<TestSuite> {
    return transport.requestParsed(TestSuite, `${TEST_SUITE_PATH}/${id}`, { ...options });
  }

  /**
   * Create a test suite. Its members run in the order given. Each member names a test the caller can
   * read, by `test_type` and either `test_id` or `test_entity_id`; a test can be in a suite at most
   * once.
   */
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

  /**
   * Update a test suite. `members`, when given, replaces every member, in the order given. Each
   * member names a test by `test_type` and either `test_id` or `test_entity_id`, and the caller must
   * be able to read the test, with one exception: a current member that the caller cannot read, or
   * whose test is missing, is kept when named by `test_type` and `test_entity_id`. A test can be in
   * a suite at most once.
   */
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

  /** Delete a test suite. The tests in it are not deleted. */
  async function remove(id: number, options: RequestOptions = {}): Promise<void> {
    await transport.requestRaw(`${TEST_SUITE_PATH}/${id}`, {
      ...options,
      method: "DELETE",
      expectContentType: "binary",
    });
  }

  /**
   * Run the members of a test suite, in order, within the request, and record the run. Each member
   * reports its `status`: `passed` or `failed` with its `result`; `refused` with the `error` its run
   * endpoint would have returned; `error` when loading the test's subject, checking the caller's
   * permission, or the run failed otherwise; `forbidden` when the caller may not run it; `missing`
   * when this instance has no such test, or the thing the test tests is gone. The suite's `status`
   * is `timeout` when the server timed the run out while it ran, `passed` when every member passed,
   * and `failed` otherwise.
   */
  async function run(id: number, options: RequestOptions = {}): Promise<TestSuiteRun> {
    return transport.requestParsed(TestSuiteRun, `${TEST_SUITE_PATH}/${id}/run`, {
      ...options,
      method: "POST",
    });
  }

  /**
   * Walk the runs of a test suite, newest first. A member's outcome has no `test_id`, `name`, or
   * `result`. It has an `error` only when the member's test exists and the caller may run it. Every
   * member's `status` is shown, even to a caller who cannot read the member's test.
   */
  async function* runPages(
    id: number,
    options: TestSuiteRunPageOptions = {},
  ): AsyncIterable<Page<TestSuiteRunRecord>> {
    yield* paginatePages(transport, `${TEST_SUITE_PATH}/${id}/runs`, TestSuiteRunRecord, {
      ...(options.offset !== undefined && { offset: options.offset }),
      ...(options.max !== undefined && { max: options.max }),
      ...(options.pageSize !== undefined && { pageSize: options.pageSize }),
      ...(options.signal !== undefined && { signal: options.signal }),
    });
  }

  return {
    list: explain("list", list),
    get: explain("get", get),
    create: explain("create", create),
    update: explain("update", update),
    delete: explain("delete", remove),
    run: explain("run", run),
    runPages: explainWalk("runPages", runPages),
  };
}
