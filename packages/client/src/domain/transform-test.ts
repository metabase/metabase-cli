import { z } from "zod";

const TransformTestTable = z
  .object({
    schema: z.string().nullable().optional(),
    name: z.string().min(1),
  })
  .loose();

const TransformTestColumn = z
  .object({
    name: z.string().min(1),
    database_type: z.string().min(1).describe("The warehouse's own spelling, e.g. VARCHAR(255)"),
  })
  .loose();

const TransformTestCell = z.union([z.string(), z.number(), z.boolean(), z.null()]);

const TransformTestRow = z.record(z.string(), TransformTestCell);

const TransformTestSqlData = z.object({ format: z.literal("sql"), sql: z.string().min(1) }).loose();

const TransformTestRowsData = z
  .object({
    format: z.literal("rows"),
    columns: z.array(TransformTestColumn).min(1),
    rows: z.array(TransformTestRow),
  })
  .loose();

const TransformTestSqlInput = TransformTestSqlData.extend({ table: TransformTestTable });

const TransformTestRowsInput = TransformTestRowsData.extend({ table: TransformTestTable });

/** Test data standing in for one table the transform reads. */
export const TransformTestInput = z.discriminatedUnion("format", [
  TransformTestSqlInput,
  TransformTestRowsInput,
]);
export type TransformTestInput = z.infer<typeof TransformTestInput>;

const TransformTestEqualsSql = TransformTestSqlData.extend({
  type: z.literal("equals"),
  name: z.string().min(1),
});

const TransformTestEqualsRows = TransformTestRowsData.extend({
  type: z.literal("equals"),
  name: z.string().min(1),
});

const TransformTestEmpty = z
  .object({
    type: z.literal("empty"),
    name: z.string().min(1),
    sql: z.string().min(1),
  })
  .loose();

/** One check against the transform's output. Names are unique within a test. */
export const TransformTestExpectation = z.union([
  TransformTestEqualsSql,
  TransformTestEqualsRows,
  TransformTestEmpty,
]);
export type TransformTestExpectation = z.infer<typeof TransformTestExpectation>;

export const TransformTest = z
  .object({
    id: z.number().int(),
    entity_id: z.string().nullable(),
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

/**
 * `error` is one expectation's own failure to run, which leaves the rest of the run reporting; the
 * run as a whole is only `passed` or `failed`.
 */
export const TransformTestStatus = z.enum(["passed", "failed", "error"]);
export type TransformTestStatus = z.infer<typeof TransformTestStatus>;

const TransformTestResultColumn = z.object({ name: z.string(), database_type: z.string() }).loose();

const TransformTestCellMismatch = z
  .object({
    column: z.string(),
    expected: TransformTestCell,
    actual: TransformTestCell,
  })
  .loose();

const TransformTestRowCounts = z
  .object({ actual: z.number().int(), expected: z.number().int() })
  .loose();

const TransformTestExpectationError = z.object({ type: z.string(), message: z.string() }).loose();

/**
 * What one expectation found. The keys beyond `name`, `type` and `status` are its type's own:
 * `equals` reports the rows the two sides disagree on, `empty` a sample of the rows its query
 * returned, and both cap what they report, with `truncated` counting what the cap dropped.
 */
export const TransformTestExpectationResult = z
  .object({
    name: z.string(),
    type: z.enum(["equals", "empty"]),
    status: TransformTestStatus,
    columns: z.array(TransformTestResultColumn).optional(),
    error: TransformTestExpectationError.optional(),
    "row-counts": TransformTestRowCounts.optional(),
    "extra-rows": z.array(TransformTestRow).optional(),
    "missing-rows": z.array(TransformTestRow).optional(),
    "cell-mismatches": z.array(TransformTestCellMismatch).optional(),
    sample: z.array(TransformTestRow).optional(),
    truncated: z.number().int().optional(),
  })
  .loose();
export type TransformTestExpectationResult = z.infer<typeof TransformTestExpectationResult>;

/**
 * What a run reported. `tables` maps each temp table the run created to the table it stood in for.
 * A run that happened reports `passed` or `failed`; a refusal is an HTTP error rather than a body.
 */
export const TransformTestRunResult = z
  .object({
    status: TransformTestStatus,
    expectations: z.array(TransformTestExpectationResult),
    tables: z.record(z.string(), z.string()),
  })
  .loose();
export type TransformTestRunResult = z.infer<typeof TransformTestRunResult>;
