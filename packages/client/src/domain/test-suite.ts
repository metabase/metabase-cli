import { z } from "zod";

import { DataTestRunResult, DataTestRunStatus } from "./data-test";

export const TestSuiteTestType = z.enum(["transform", "card", "segment"]);
export type TestSuiteTestType = z.infer<typeof TestSuiteTestType>;

// A stored member keeps whatever type it was written with, including one this client or the
// server answering does not know, so its `test_type` is open.
const memberRef = {
  test_type: z.string(),
  test_entity_id: z.string(),
  position: z.number().int(),
};

// Only a member whose test exists and that the caller can read carries the test's id and name.
const ReadableMember = z
  .object({
    ...memberRef,
    status: z.literal("readable"),
    test_id: z.number().int(),
    name: z.string(),
  })
  .loose();

const HiddenMember = z.object({ ...memberRef, status: z.enum(["unreadable", "missing"]) }).loose();

export const TestSuiteMember = z.discriminatedUnion("status", [ReadableMember, HiddenMember]);
export type TestSuiteMember = z.infer<typeof TestSuiteMember>;

export const TestSuite = z
  .object({
    id: z.number().int(),
    entity_id: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    creator_id: z.number().int(),
    members: z.array(TestSuiteMember),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .loose();
export type TestSuite = z.infer<typeof TestSuite>;

export const TestSuiteCompact = TestSuite.pick({
  id: true,
  name: true,
  description: true,
  members: true,
}).strip();
export type TestSuiteCompact = z.infer<typeof TestSuiteCompact>;

const TestSuiteMemberById = z
  .object({ test_type: TestSuiteTestType, test_id: z.number().int().positive() })
  .strict();

const TestSuiteMemberByEntityId = z
  .object({ test_type: TestSuiteTestType, test_entity_id: z.string().min(1) })
  .strict();

// The server takes exactly one of `test_id` and `test_entity_id`.
const TestSuiteMemberInput = z.union([TestSuiteMemberById, TestSuiteMemberByEntityId]);

export const TestSuiteCreateInput = z
  .object({
    name: z.string().min(1),
    description: z.string().nullable().optional(),
    members: z.array(TestSuiteMemberInput),
  })
  .strict();
export type TestSuiteCreateInput = z.infer<typeof TestSuiteCreateInput>;

export const TestSuiteUpdateInput = TestSuiteCreateInput.partial().strict();
export type TestSuiteUpdateInput = z.infer<typeof TestSuiteUpdateInput>;

export const TestSuiteMemberStatus = z.enum([
  "passed",
  "failed",
  "refused",
  "error",
  "forbidden",
  "missing",
]);
export type TestSuiteMemberStatus = z.infer<typeof TestSuiteMemberStatus>;

// `error_code` is present only on a refusal, as the test's own run endpoint would give it.
const TestSuiteRunError = z
  .object({
    error_code: z.string().optional(),
    message: z.string().nullable(),
  })
  .loose();

// The run history withholds `error` unless the reader may run the member's test.
const storedMemberOutcome = {
  ...memberRef,
  status: TestSuiteMemberStatus,
  data_test_run_id: z.number().int().optional(),
  error: TestSuiteRunError.optional(),
};

// One member's outcome, as answered to the user who ran the suite: `test_id` and `name` only when
// that user can read the test, and `result` only when it passed or failed.
export const TestSuiteRunEntry = z
  .object({
    ...storedMemberOutcome,
    test_id: z.number().int().optional(),
    name: z.string().optional(),
    result: DataTestRunResult.optional(),
  })
  .loose();
export type TestSuiteRunEntry = z.infer<typeof TestSuiteRunEntry>;

export const TestSuiteRun = z
  .object({
    id: z.number().int(),
    suite_id: z.number().int(),
    status: z.enum(["passed", "failed", "timeout"]),
    members: z.array(TestSuiteRunEntry),
  })
  .loose();
export type TestSuiteRun = z.infer<typeof TestSuiteRun>;

const TestSuiteRunInitiator = z
  .object({
    id: z.number().int(),
    email: z.string(),
    first_name: z.string().nullable(),
    last_name: z.string().nullable(),
  })
  .loose();

// A run in a suite's history. `members` is null while the run is started, and stays null when it
// ends in `error`, or in `timeout` because the process running it stopped. `suite_id` is null once
// the suite is deleted.
export const TestSuiteRunRecord = z
  .object({
    id: z.number().int(),
    suite_id: z.number().int().nullable(),
    status: DataTestRunStatus,
    start_time: z.string(),
    end_time: z.string().nullable(),
    last_heartbeat: z.string(),
    initiated_by: z.number().int().nullable(),
    initiated_by_user: TestSuiteRunInitiator.nullable(),
    members: z.array(z.object(storedMemberOutcome).loose()).nullable(),
  })
  .loose();
export type TestSuiteRunRecord = z.infer<typeof TestSuiteRunRecord>;

export const TestSuiteRunRecordCompact = TestSuiteRunRecord.pick({
  id: true,
  status: true,
  start_time: true,
  end_time: true,
  initiated_by: true,
}).strip();
export type TestSuiteRunRecordCompact = z.infer<typeof TestSuiteRunRecordCompact>;
