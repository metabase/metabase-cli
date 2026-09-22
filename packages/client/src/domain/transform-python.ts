import { z } from "zod";

import { TransformSourceTableEntry } from "./transform";

// The one library Metabase serves is `common.py`, the user module every Python transform can
// import; the path is a key, not a file system location.
export const PythonLibrary = z
  .object({
    path: z.string(),
    source: z.string().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .loose();
export type PythonLibrary = z.infer<typeof PythonLibrary>;

export const PythonLibraryUpdateInput = z.object({ source: z.string() }).strict();
export type PythonLibraryUpdateInput = z.infer<typeof PythonLibraryUpdateInput>;

const TEST_RUN_ROW_LIMIT = { min: 2, max: 100 } as const;

const TestRunRowLimit = z.number().int().min(TEST_RUN_ROW_LIMIT.min).max(TEST_RUN_ROW_LIMIT.max);

// The server samples every source table to `per_input_row_limit` rows and keeps at most
// `output_row_limit` of the result; both default to 100 server-side.
export const PythonTestRunInput = z
  .object({
    code: z.string(),
    source_tables: z.array(TransformSourceTableEntry).min(1),
    output_row_limit: TestRunRowLimit.optional(),
    per_input_row_limit: TestRunRowLimit.optional(),
  })
  .strict();
export type PythonTestRunInput = z.infer<typeof PythonTestRunInput>;

export const PythonTestRunOutput = z.object({
  cols: z.array(z.object({ name: z.string() }).loose()),
  rows: z.array(z.unknown()),
});
export type PythonTestRunOutput = z.infer<typeof PythonTestRunOutput>;

export const PythonTestRunError = z.object({ message: z.string() }).loose();
export type PythonTestRunError = z.infer<typeof PythonTestRunError>;

const PythonTestRunSucceeded = z.object({
  outcome: z.literal("succeeded"),
  logs: z.string(),
  output: PythonTestRunOutput,
});

const PythonTestRunFailed = z.object({
  outcome: z.literal("failed"),
  logs: z.string(),
  error: PythonTestRunError,
});

// A run that produced rows answers them; one the runner rejected answers its message. Both carry
// the run's logs.
export const PythonTestRunResult = z.discriminatedUnion("outcome", [
  PythonTestRunSucceeded,
  PythonTestRunFailed,
]);
export type PythonTestRunResult = z.infer<typeof PythonTestRunResult>;
