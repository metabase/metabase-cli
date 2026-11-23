import { z } from "zod";

import { DataTestRunResult, DataTestType } from "./data-test";

export const TestSuiteMember = z
  .object({
    test_type: DataTestType,
    test_id: z.number().int(),
  })
  .loose();
export type TestSuiteMember = z.infer<typeof TestSuiteMember>;

export const TestSuite = z
  .object({
    id: z.number().int(),
    entity_id: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    tests: z.array(TestSuiteMember),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .loose();
export type TestSuite = z.infer<typeof TestSuite>;

export const TestSuiteCompact = TestSuite.pick({
  id: true,
  name: true,
  description: true,
}).strip();
export type TestSuiteCompact = z.infer<typeof TestSuiteCompact>;

const TestSuiteMemberInput = z
  .object({
    test_type: DataTestType,
    test_id: z.number().int().positive(),
  })
  .strict();

export const TestSuiteCreateInput = z
  .object({
    name: z.string().min(1),
    description: z.string().nullable().optional(),
    tests: z.array(TestSuiteMemberInput),
  })
  .strict();
export type TestSuiteCreateInput = z.infer<typeof TestSuiteCreateInput>;

export const TestSuiteUpdateInput = TestSuiteCreateInput.partial().strict();
export type TestSuiteUpdateInput = z.infer<typeof TestSuiteUpdateInput>;

export const TestSuiteRunEntry = z
  .object({
    test_type: DataTestType,
    test_id: z.number().int(),
    result: DataTestRunResult,
  })
  .loose();
export type TestSuiteRunEntry = z.infer<typeof TestSuiteRunEntry>;

// The result of every test in the suite, each run as its own test runs.
export const TestSuiteRun = z
  .object({
    suite_id: z.number().int(),
    results: z.array(TestSuiteRunEntry),
  })
  .loose();
export type TestSuiteRun = z.infer<typeof TestSuiteRun>;
