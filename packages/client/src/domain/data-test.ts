import { z } from "zod";

import { TransformTestExpectation, TransformTestInput } from "./transform-test";

export const DATA_TEST_TYPES = ["transform", "card", "segment", "measure", "action"] as const;
export const DataTestType = z.enum(DATA_TEST_TYPES);
export type DataTestType = z.infer<typeof DataTestType>;

// The fields every test type stores beside the id of the entity it tests.
export const dataTestFields = {
  id: z.number().int(),
  entity_id: z.string(),
  creator_id: z.number().int(),
  name: z.string(),
  description: z.string().nullable(),
  inputs: z.array(TransformTestInput),
  expectations: z.array(TransformTestExpectation),
  created_at: z.string(),
  updated_at: z.string(),
};

// The fields every test type's create body takes beside the id of the entity it tests. `now` is
// the timestamp a relative date filter reads as the current time.
export const dataTestBodyFields = {
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  now: z.string().min(1).nullable().optional(),
  inputs: z.array(TransformTestInput),
  expectations: z.array(TransformTestExpectation),
};

const DataTestCell = z.union([z.boolean(), z.number(), z.string(), z.null()]);

export const DataTestParameters = z.record(z.string(), DataTestCell);
export type DataTestParameters = z.infer<typeof DataTestParameters>;

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

// Every code the server publishes for a test's refusal or failed run is prefixed by its type
// (`card-test.missing-inputs`), including codes newer than this client.
export function isDataTestCode(value: string): boolean {
  return DATA_TEST_TYPES.some((type) => value.startsWith(`${type}-test.`));
}
