import { z } from "zod";

import {
  DATA_TEST_SCHEMAS,
  type DataTest,
  type DataTestDefinition,
  type DataTestPatch,
  DataTestRunResult,
  DataTestType,
} from "../domain/data-test";
import type { RequestOptions, Transport } from "../http/transport";
import type { ListResult } from "../list";
import { explainer, type ParameterRequirement } from "../version/refusal";

const SCHEMAS: { [T in DataTestType]: z.ZodType<DataTest<T>> } = DATA_TEST_SCHEMAS;

// The feature each type needs beyond the transform tests every server with data tests serves. A
// server without it has no route for the type, so the request names no field.
const TYPE_REQUIREMENTS: Record<DataTestType, readonly ParameterRequirement[]> = {
  transform: [],
  card: [{ feature: "cardTests", fields: [] }],
  segment: [{ feature: "segmentTests", fields: [] }],
  measure: [{ feature: "measureTests", fields: [] }],
  action: [{ feature: "actionTests", fields: [] }],
};

function typeRequirements(type: DataTestType): readonly ParameterRequirement[] {
  return TYPE_REQUIREMENTS[DataTestType.parse(type)];
}

// A caller outside TypeScript can pass any string as the type, and it lands in the path.
function testsPath(type: DataTestType): string {
  return `/api/ee/${DataTestType.parse(type)}-test`;
}

export interface DataTestListParams {
  "include-archived"?: boolean;
}

// Every path parameter here is a numeric id or a parsed test type, so no fragment needs
// `encodeURIComponent`.
export function dataTestResource(transport: Transport) {
  const { explain } = explainer(transport, "dataTest");

  /**
   * List the tests of one type the caller can read, optionally only those of one entity. The tests of
   * an archived card or segment are left out unless `include-archived` is true; the other types take
   * no such filter and refuse it with a 400. The server reports no total.
   */
  async function list<T extends DataTestType>(
    type: T,
    entityId: number | null = null,
    params: DataTestListParams = {},
    options: RequestOptions = {},
  ): Promise<ListResult<DataTest<T>>> {
    const data = await transport.requestParsed(z.array(SCHEMAS[type]), testsPath(type), {
      ...options,
      query: {
        [`${type}-id`]: entityId === null ? undefined : entityId,
        "include-archived": params["include-archived"],
      },
    });
    return { data, total: null };
  }

  /** Get a test of one type by id. */
  async function get<T extends DataTestType>(
    type: T,
    id: number,
    options: RequestOptions = {},
  ): Promise<DataTest<T>> {
    return transport.requestParsed(SCHEMAS[type], `${testsPath(type)}/${id}`, { ...options });
  }

  /**
   * Create a test of the entity `entityId`. The server validates the inputs and expectations against
   * the entity before saving, and refuses with an `HttpError` whose `errorCode` starts with
   * `<type>-test.` when they cannot run.
   */
  async function create<T extends DataTestType>(
    type: T,
    entityId: number,
    definition: DataTestDefinition<T>,
    options: RequestOptions = {},
  ): Promise<DataTest<T>> {
    return transport.requestParsed(SCHEMAS[type], testsPath(type), {
      ...options,
      method: "POST",
      body: { ...definition, [`${type}_id`]: entityId },
    });
  }

  /**
   * Update a test by id, leaving omitted fields unchanged. A patch that touches the entity, inputs or
   * expectations is validated as on create, with the same refusal.
   */
  async function update<T extends DataTestType>(
    type: T,
    id: number,
    patch: DataTestPatch<T>,
    options: RequestOptions = {},
  ): Promise<DataTest<T>> {
    return transport.requestParsed(SCHEMAS[type], `${testsPath(type)}/${id}`, {
      ...options,
      method: "PUT",
      body: patch,
    });
  }

  /** Delete a test by id. */
  async function remove(
    type: DataTestType,
    id: number,
    options: RequestOptions = {},
  ): Promise<void> {
    await transport.requestRaw(`${testsPath(type)}/${id}`, {
      ...options,
      method: "DELETE",
      expectContentType: "binary",
    });
  }

  /**
   * Run a saved test by id, in one synchronous request. A result means the run happened: `status` is
   * `passed` or `failed` and every expectation reports what it found, one that could not be evaluated
   * as its own `error`. An `HttpError` whose `errorCode` starts with `<type>-test.` means the run was
   * refused and nothing meaningful ran.
   */
  async function run(
    type: DataTestType,
    id: number,
    options: RequestOptions = {},
  ): Promise<DataTestRunResult> {
    return transport.requestParsed(DataTestRunResult, `${testsPath(type)}/${id}/run`, {
      ...options,
      method: "POST",
    });
  }

  // Each callback is an arrow, so it is read after the method and the method's type parameter
  // survives the wrapping.
  return {
    list: explain("list", list, (type) => typeRequirements(type)),
    get: explain("get", get, (type) => typeRequirements(type)),
    create: explain("create", create, (type) => typeRequirements(type)),
    update: explain("update", update, (type) => typeRequirements(type)),
    delete: explain("delete", remove, (type) => typeRequirements(type)),
    run: explain("run", run, (type) => typeRequirements(type)),
  };
}
