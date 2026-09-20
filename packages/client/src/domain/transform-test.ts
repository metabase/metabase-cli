import { z } from "zod";

export const TransformTestTable = z
  .object({
    schema: z.string().min(1).nullable().optional(),
    name: z.string().min(1),
  })
  .loose();
export type TransformTestTable = z.infer<typeof TransformTestTable>;

export const TransformTestColumn = z
  .object({
    name: z.string().min(1),
    cast_type: z.string().min(1),
  })
  .loose();
export type TransformTestColumn = z.infer<typeof TransformTestColumn>;

const TransformTestCell = z.union([z.boolean(), z.number(), z.string(), z.null()]);

export const TransformTestRow = z.record(z.string(), TransformTestCell);
export type TransformTestRow = z.infer<typeof TransformTestRow>;

const TransformTestSqlInput = z
  .object({
    table: TransformTestTable,
    format: z.literal("sql"),
    sql: z.string().min(1),
  })
  .loose();

const TransformTestRowsInput = z
  .object({
    table: TransformTestTable,
    format: z.literal("rows"),
    columns: z.array(TransformTestColumn).min(1),
    rows: z.array(TransformTestRow),
  })
  .loose();

export const TransformTestInput = z.discriminatedUnion("format", [
  TransformTestSqlInput,
  TransformTestRowsInput,
]);
export type TransformTestInput = z.infer<typeof TransformTestInput>;

const TransformTestEqualsSqlExpectation = z
  .object({
    type: z.literal("equals"),
    name: z.string().min(1),
    format: z.literal("sql"),
    sql: z.string().min(1),
  })
  .loose();

const TransformTestEqualsRowsExpectation = z
  .object({
    type: z.literal("equals"),
    name: z.string().min(1),
    format: z.literal("rows"),
    columns: z.array(TransformTestColumn).min(1),
    rows: z.array(TransformTestRow),
  })
  .loose();

const TransformTestEqualsExpectation = z.discriminatedUnion("format", [
  TransformTestEqualsSqlExpectation,
  TransformTestEqualsRowsExpectation,
]);

const TransformTestEmptyExpectation = z
  .object({
    type: z.literal("empty"),
    name: z.string().min(1),
    sql: z.string().min(1),
  })
  .loose();

export const TransformTestExpectation = z.discriminatedUnion("type", [
  TransformTestEqualsExpectation,
  TransformTestEmptyExpectation,
]);
export type TransformTestExpectation = z.infer<typeof TransformTestExpectation>;

export const TransformTest = z
  .object({
    id: z.number().int(),
    entity_id: z.string(),
    transform_id: z.number().int(),
    creator_id: z.number().int(),
    name: z.string(),
    description: z.string().nullable(),
    inputs: z.array(TransformTestInput),
    expectations: z.array(TransformTestExpectation),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .loose();
export type TransformTest = z.infer<typeof TransformTest>;

export const TransformTestCompact = TransformTest.pick({
  id: true,
  transform_id: true,
  name: true,
  description: true,
}).strip();
export type TransformTestCompact = z.infer<typeof TransformTestCompact>;

export const TransformTestCreateInput = z
  .object({
    transform_id: z.number().int().positive(),
    name: z.string().min(1),
    description: z.string().nullable().optional(),
    inputs: z.array(TransformTestInput),
    expectations: z.array(TransformTestExpectation),
  })
  .loose();
export type TransformTestCreateInput = z.infer<typeof TransformTestCreateInput>;

export const TransformTestUpdateInput = z
  .object({
    transform_id: z.number().int().positive().optional(),
    name: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    inputs: z.array(TransformTestInput).optional(),
    expectations: z.array(TransformTestExpectation).optional(),
  })
  .loose();
export type TransformTestUpdateInput = z.infer<typeof TransformTestUpdateInput>;

export const TransformTestResultColumn = z
  .object({
    name: z.string(),
    database_type: z.string(),
  })
  .loose();
export type TransformTestResultColumn = z.infer<typeof TransformTestResultColumn>;

const TransformTestExpectationError = z
  .object({
    type: z.string(),
    message: z.string(),
  })
  .loose();

const TransformTestCellMismatch = z
  .object({
    column: z.string(),
    expected: TransformTestCell,
    actual: TransformTestCell,
  })
  .loose();

const TransformTestRowCounts = z
  .object({
    actual: z.number().int(),
    expected: z.number().int(),
  })
  .loose();

const TransformTestEqualsFindings = z
  .object({
    name: z.string(),
    type: z.literal("equals"),
    status: z.enum(["passed", "failed"]),
    columns: z.array(TransformTestResultColumn),
    "row-counts": TransformTestRowCounts,
    "extra-rows": z.array(TransformTestRow),
    "missing-rows": z.array(TransformTestRow),
    "cell-mismatches": z.array(TransformTestCellMismatch),
    truncated: z.number().int(),
  })
  .loose();

const TransformTestEqualsError = z
  .object({
    name: z.string(),
    type: z.literal("equals"),
    status: z.literal("error"),
    error: TransformTestExpectationError,
  })
  .loose();

const TransformTestEqualsResult = z.discriminatedUnion("status", [
  TransformTestEqualsFindings,
  TransformTestEqualsError,
]);

const TransformTestEmptyPassed = z
  .object({
    name: z.string(),
    type: z.literal("empty"),
    status: z.literal("passed"),
  })
  .loose();

const TransformTestEmptyFailed = z
  .object({
    name: z.string(),
    type: z.literal("empty"),
    status: z.literal("failed"),
    columns: z.array(TransformTestResultColumn),
    sample: z.array(TransformTestRow),
    truncated: z.number().int(),
  })
  .loose();

const TransformTestEmptyError = z
  .object({
    name: z.string(),
    type: z.literal("empty"),
    status: z.literal("error"),
    error: TransformTestExpectationError,
  })
  .loose();

const TransformTestEmptyResult = z.discriminatedUnion("status", [
  TransformTestEmptyPassed,
  TransformTestEmptyFailed,
  TransformTestEmptyError,
]);

export const TransformTestExpectationResult = z.discriminatedUnion("type", [
  TransformTestEqualsResult,
  TransformTestEmptyResult,
]);
export type TransformTestExpectationResult = z.infer<typeof TransformTestExpectationResult>;

export const TransformTestRunResult = z
  .object({
    status: z.enum(["passed", "failed"]),
    expectations: z.array(TransformTestExpectationResult),
    tables: z.record(z.string(), z.string()),
  })
  .loose();
export type TransformTestRunResult = z.infer<typeof TransformTestRunResult>;

export const TransformTestRefusalCode = z.enum([
  "transform-test.unknown-column",
  "transform-test.ambiguous-column",
  "transform-test.missing-inputs",
  "transform-test.unused-inputs",
  "transform-test.duplicate-input-table",
  "transform-test.unparseable-source",
  "transform-test.unremapped-reference",
  "transform-test.unsupported-transform",
  "transform-test.unsupported-driver",
  "transform-test.transform-failed",
  "transform-test.setup-failed",
  "transform-test.expectation-failed",
  "transform-test.unsupported-format",
]);
export type TransformTestRefusalCode = z.infer<typeof TransformTestRefusalCode>;

export function isTransformTestRefusalCode(value: string): value is TransformTestRefusalCode {
  return TransformTestRefusalCode.safeParse(value).success;
}
