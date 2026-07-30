import { z } from "zod";

export const TestRunTargetType = z.enum(["transform", "card"]);
export type TestRunTargetType = z.infer<typeof TestRunTargetType>;

export const TestRunInput = z
  .object({
    table_id: z.number().int().positive(),
    // null on engines without schemas (e.g. MySQL targets with no schema segment).
    schema: z.string().nullable(),
    name: z.string(),
    columns: z.array(z.string()),
  })
  .loose();
export type TestRunInput = z.infer<typeof TestRunInput>;

export const TestRunInputCompact = TestRunInput.pick({
  table_id: true,
  schema: true,
  name: true,
  columns: true,
}).strip();
export type TestRunInputCompact = z.infer<typeof TestRunInputCompact>;

export const AssertionResult = z
  .object({
    name: z.string(),
    status: z.enum(["passed", "failed", "warn"]),
    failing_row_count: z.number().int().nonnegative(),
    sample_rows: z.array(z.array(z.unknown())).nullable(),
    columns: z.array(z.string()),
  })
  .loose();
export type AssertionResult = z.infer<typeof AssertionResult>;

export const AssertionResultCompact = AssertionResult.pick({
  name: true,
  status: true,
  failing_row_count: true,
}).strip();
export type AssertionResultCompact = z.infer<typeof AssertionResultCompact>;

export const TestRunResult = z
  .object({
    status: z.enum(["passed", "failed"]),
    diff: z.unknown(),
    assertions: z.array(AssertionResult).nullable().optional(),
  })
  .loose();
export type TestRunResult = z.infer<typeof TestRunResult>;

export const TestRunResultCompact = TestRunResult.pick({
  status: true,
  diff: true,
  assertions: true,
}).strip();
export type TestRunResultCompact = z.infer<typeof TestRunResultCompact>;
