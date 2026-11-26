import { z } from "zod";

import type { Features } from "../version/features";

export const DATA_TEST_TYPES = ["transform", "card", "segment", "measure", "action"] as const;
export const DataTestType = z.enum(DATA_TEST_TYPES);
export type DataTestType = z.infer<typeof DataTestType>;

export const DataTestTable = z
  .object({
    schema: z.string().min(1).nullable().optional(),
    name: z.string().min(1),
  })
  .loose();
export type DataTestTable = z.infer<typeof DataTestTable>;

export const DataTestColumn = z
  .object({
    name: z.string().min(1),
    cast_type: z.string().min(1),
  })
  .loose();
export type DataTestColumn = z.infer<typeof DataTestColumn>;

const DataTestCell = z.union([z.boolean(), z.number(), z.string(), z.null()]);

export const DataTestRow = z.record(z.string(), DataTestCell);
export type DataTestRow = z.infer<typeof DataTestRow>;

const DataTestSqlInput = z
  .object({
    table: DataTestTable,
    format: z.literal("sql"),
    sql: z.string().min(1),
  })
  .loose();

const DataTestRowsInput = z
  .object({
    table: DataTestTable,
    format: z.literal("rows"),
    columns: z.array(DataTestColumn).min(1),
    rows: z.array(DataTestRow),
  })
  .loose();

export const DataTestInput = z.discriminatedUnion("format", [DataTestSqlInput, DataTestRowsInput]);
export type DataTestInput = z.infer<typeof DataTestInput>;

const DataTestEqualsSqlExpectation = z
  .object({
    type: z.literal("equals"),
    name: z.string().min(1),
    format: z.literal("sql"),
    sql: z.string().min(1),
  })
  .loose();

const DataTestEqualsRowsExpectation = z
  .object({
    type: z.literal("equals"),
    name: z.string().min(1),
    format: z.literal("rows"),
    columns: z.array(DataTestColumn).min(1),
    rows: z.array(DataTestRow),
  })
  .loose();

const DataTestEqualsExpectation = z.discriminatedUnion("format", [
  DataTestEqualsSqlExpectation,
  DataTestEqualsRowsExpectation,
]);

const DataTestEmptyExpectation = z
  .object({
    type: z.literal("empty"),
    name: z.string().min(1),
    sql: z.string().min(1),
  })
  .loose();

export const DataTestExpectation = z.discriminatedUnion("type", [
  DataTestEqualsExpectation,
  DataTestEmptyExpectation,
]);
export type DataTestExpectation = z.infer<typeof DataTestExpectation>;

export const DataTestResultColumn = z
  .object({
    name: z.string(),
    database_type: z.string(),
  })
  .loose();
export type DataTestResultColumn = z.infer<typeof DataTestResultColumn>;

const DataTestExpectationError = z
  .object({
    type: z.string(),
    message: z.string(),
  })
  .loose();

const DataTestCellMismatch = z
  .object({
    column: z.string(),
    expected: DataTestCell,
    actual: DataTestCell,
  })
  .loose();

const DataTestRowCounts = z
  .object({
    actual: z.number().int(),
    expected: z.number().int(),
  })
  .loose();

const DataTestEqualsFindings = z
  .object({
    name: z.string(),
    type: z.literal("equals"),
    status: z.enum(["passed", "failed"]),
    columns: z.array(DataTestResultColumn),
    "row-counts": DataTestRowCounts,
    "extra-rows": z.array(DataTestRow),
    "missing-rows": z.array(DataTestRow),
    "cell-mismatches": z.array(DataTestCellMismatch),
    truncated: z.number().int(),
  })
  .loose();

const DataTestEqualsError = z
  .object({
    name: z.string(),
    type: z.literal("equals"),
    status: z.literal("error"),
    error: DataTestExpectationError,
  })
  .loose();

const DataTestEqualsResult = z.discriminatedUnion("status", [
  DataTestEqualsFindings,
  DataTestEqualsError,
]);

const DataTestEmptyPassed = z
  .object({
    name: z.string(),
    type: z.literal("empty"),
    status: z.literal("passed"),
  })
  .loose();

const DataTestEmptyFailed = z
  .object({
    name: z.string(),
    type: z.literal("empty"),
    status: z.literal("failed"),
    columns: z.array(DataTestResultColumn),
    sample: z.array(DataTestRow),
    truncated: z.number().int(),
  })
  .loose();

const DataTestEmptyError = z
  .object({
    name: z.string(),
    type: z.literal("empty"),
    status: z.literal("error"),
    error: DataTestExpectationError,
  })
  .loose();

const DataTestEmptyResult = z.discriminatedUnion("status", [
  DataTestEmptyPassed,
  DataTestEmptyFailed,
  DataTestEmptyError,
]);

export const DataTestExpectationResult = z.discriminatedUnion("type", [
  DataTestEqualsResult,
  DataTestEmptyResult,
]);
export type DataTestExpectationResult = z.infer<typeof DataTestExpectationResult>;

export const DataTestRunResult = z
  .object({
    status: z.enum(["passed", "failed", "error"]),
    expectations: z.array(DataTestExpectationResult),
    tables: z.record(z.string(), z.string()),
  })
  .loose();
export type DataTestRunResult = z.infer<typeof DataTestRunResult>;

export const DataTestParameters = z.record(z.string(), DataTestCell);
export type DataTestParameters = z.infer<typeof DataTestParameters>;

// The fields every type stores beside the id of the entity it tests.
const dataTestFields = {
  id: z.number().int(),
  entity_id: z.string(),
  creator_id: z.number().int(),
  name: z.string(),
  description: z.string().nullable(),
  inputs: z.array(DataTestInput),
  expectations: z.array(DataTestExpectation),
  created_at: z.string(),
  updated_at: z.string(),
};

const entityId = z.number().int();

const DATA_TEST_TYPES_WITH_NOW: ReadonlySet<DataTestType> = new Set(["transform", "card"]);

export function dataTestTakesNow(type: DataTestType): boolean {
  return DATA_TEST_TYPES_WITH_NOW.has(type);
}

const storedNow = z.string().nullable();

// A saved test of each type: the shared fields, and the id of the entity it tests under that type's
// own key.
export const DATA_TEST_SCHEMAS = {
  transform: z.object({ ...dataTestFields, transform_id: entityId, now: storedNow }).loose(),
  card: z.object({ ...dataTestFields, card_id: entityId, now: storedNow }).loose(),
  segment: z.object({ ...dataTestFields, segment_id: entityId }).loose(),
  measure: z.object({ ...dataTestFields, measure_id: entityId }).loose(),
  action: z
    .object({ ...dataTestFields, action_id: entityId, parameters: DataTestParameters.nullable() })
    .loose(),
} satisfies Record<DataTestType, z.ZodType>;

type DataTestShapes = { [T in DataTestType]: z.infer<(typeof DATA_TEST_SCHEMAS)[T]> };
export type DataTest<T extends DataTestType = DataTestType> = DataTestShapes[T];

const TransformTestWireV65 = DATA_TEST_SCHEMAS.transform.omit({ now: true });

function readingRealClock(wire: z.infer<typeof TransformTestWireV65>): DataTest<"transform"> {
  return { ...wire, now: null };
}

export function dataTestSchema<T extends DataTestType>(
  type: T,
  features: Features,
): z.ZodType<DataTest<T>> {
  const readers: { [K in DataTestType]: z.ZodType<DataTest<K>> } = {
    ...DATA_TEST_SCHEMAS,
    transform: features.dataTestFixedClock
      ? DATA_TEST_SCHEMAS.transform
      : TransformTestWireV65.transform(readingRealClock),
  };
  return readers[type];
}

const ENTITY_IDS: { [T in DataTestType]: (test: DataTest<T>) => number } = {
  transform: (test) => test.transform_id,
  card: (test) => test.card_id,
  segment: (test) => test.segment_id,
  measure: (test) => test.measure_id,
  action: (test) => test.action_id,
};

/** The id of the entity a test of `type` tests. */
export function testedEntityId<T extends DataTestType>(type: T, test: DataTest<T>): number {
  return ENTITY_IDS[type](test);
}

export const DataTestCompact = z
  .object(dataTestFields)
  .pick({ id: true, name: true, description: true })
  .strip();
export type DataTestCompact = z.infer<typeof DataTestCompact>;

export const DataTestWithNowCompact = z
  .object({ ...dataTestFields, now: storedNow })
  .pick({ id: true, name: true, description: true, now: true })
  .strip();
export type DataTestWithNowCompact = z.infer<typeof DataTestWithNowCompact>;

/**
 * A test as a client writes it, without the entity it tests. The server closes this map, so an
 * unrecognized key is a 400 there.
 */
export const DataTestDefinition = z
  .object({
    name: z.string().min(1),
    description: z.string().nullable().optional(),
    inputs: z.array(DataTestInput),
    expectations: z.array(DataTestExpectation),
  })
  .strict();

/**
 * `now` is the moment the entity reads as the current time when a run compiles it, an ISO-8601
 * date-time with an offset; without it, the entity reads the real clock.
 */
export const DataTestDefinitionWithNow = DataTestDefinition.extend({
  now: z.string().min(1).nullable().optional(),
}).strict();

const DATA_TEST_DEFINITIONS = {
  transform: DataTestDefinitionWithNow,
  card: DataTestDefinitionWithNow,
  segment: DataTestDefinition,
  measure: DataTestDefinition,
  action: DataTestDefinition.extend({
    parameters: DataTestParameters.nullable().optional(),
  }).strict(),
} satisfies Record<DataTestType, z.ZodType>;

type DataTestDefinitions = { [T in DataTestType]: z.infer<(typeof DATA_TEST_DEFINITIONS)[T]> };
export type DataTestDefinition<T extends DataTestType = DataTestType> = DataTestDefinitions[T];

type DataTestFields<T extends DataTestType> = DataTestDefinition<T> & Record<`${T}_id`, number>;

// A patch moves the test to another entity when it names one under the type's own key.
export type DataTestPatch<T extends DataTestType = DataTestType> = {
  [K in keyof DataTestFields<T>]?: DataTestFields<T>[K] | undefined;
};

export const DataTestRunStatus = z.enum(["started", "passed", "failed", "error", "timeout"]);
export type DataTestRunStatus = z.infer<typeof DataTestRunStatus>;

// The record of one run, which the run history lists. `test_id` is null once the test is deleted.
export const DataTestRun = z
  .object({
    id: z.number().int(),
    test_type: DataTestType,
    test_id: z.number().int().nullable(),
    status: DataTestRunStatus,
    start_time: z.string(),
    end_time: z.string().nullable(),
    initiated_by: z.number().int().nullable(),
    last_heartbeat: z.string(),
  })
  .loose();
export type DataTestRun = z.infer<typeof DataTestRun>;

export const DataTestRunCompact = DataTestRun.pick({
  id: true,
  test_type: true,
  test_id: true,
  initiated_by: true,
  start_time: true,
  end_time: true,
  status: true,
}).strip();
export type DataTestRunCompact = z.infer<typeof DataTestRunCompact>;

// Every code the server publishes for a test's refusal or failed run is prefixed by its type
// (`card-test.missing-inputs`), including codes newer than this client.
export function isDataTestCode(value: string): boolean {
  return DATA_TEST_TYPES.some((type) => value.startsWith(`${type}-test.`));
}
