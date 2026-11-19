import { z } from "zod";

import {
  type DataTest,
  type DataTestDefinition,
  type DataTestPatch,
  DataTestRunResult,
  dataTestSchema,
  type DataTestType,
} from "../domain/data-test";
import type { RequestOptions, Transport } from "../http/transport";
import type { ListResult } from "../list";
import { explainer, type ParameterRequirement } from "../version/refusal";

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
  return TYPE_REQUIREMENTS[type];
}

function fixesClock(body: object): boolean {
  return "now" in body && body.now !== undefined && body.now !== null;
}

function testsPath(type: DataTestType): string {
  return `/api/ee/${type}-test`;
}

// Every path parameter here is a numeric id or a test type, so no fragment needs
// `encodeURIComponent`.
export function dataTestResource(transport: Transport) {
  const { explain } = explainer(transport, "dataTest");

  // A server that fixes no clock drops `now` unread and saves the test on the real clock.
  async function requireFixedClock(body: object, options: RequestOptions): Promise<void> {
    if (fixesClock(body)) {
      await transport.requireFeatures(["dataTestFixedClock"], options);
    }
  }

  /**
   * List the tests of one type the caller can read, optionally only those of one entity. The server
   * answers a bare array, so the count is the array's own length and the server reports none.
   */
  async function list<T extends DataTestType>(
    type: T,
    entityId: number | null = null,
    options: RequestOptions = {},
  ): Promise<ListResult<DataTest<T>>> {
    const { features } = await transport.server(options);
    const reader = z.array(dataTestSchema(type, features));
    const data = await transport.requestParsed(reader, testsPath(type), {
      ...options,
      query: { [`${type}-id`]: entityId === null ? undefined : entityId },
    });
    return { data, total: null };
  }

  /** Get a test of one type by id. */
  async function get<T extends DataTestType>(
    type: T,
    id: number,
    options: RequestOptions = {},
  ): Promise<DataTest<T>> {
    const { features } = await transport.server(options);
    return transport.requestParsed(dataTestSchema(type, features), `${testsPath(type)}/${id}`, {
      ...options,
    });
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
    await requireFixedClock(definition, options);
    const { features } = await transport.server(options);
    return transport.requestParsed(dataTestSchema(type, features), testsPath(type), {
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
    await requireFixedClock(patch, options);
    const { features } = await transport.server(options);
    return transport.requestParsed(dataTestSchema(type, features), `${testsPath(type)}/${id}`, {
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
