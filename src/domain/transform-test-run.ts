import { z } from "zod";

import type { ResourceView } from "./view";

export const TestRunInput = z
  .object({
    table_id: z.number().int().positive(),
    schema: z.string(),
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

function formatColumns(value: unknown): string {
  return Array.isArray(value) ? value.join(", ") : String(value ?? "");
}

export const testRunInputView: ResourceView<TestRunInput> = {
  compactPick: TestRunInputCompact,
  tableColumns: [
    { key: "table_id", label: "Table ID" },
    { key: "schema", label: "Schema" },
    { key: "name", label: "Name" },
    { key: "columns", label: "Columns", format: formatColumns },
  ],
};

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

export const TestRunResult = z
  .object({
    status: z.enum(["passed", "failed"]),
    diff: z.unknown(),
    assertions: z.array(AssertionResult).nullable().optional(),
    test_run_id: z.number().int().positive().nullable(),
  })
  .loose();
export type TestRunResult = z.infer<typeof TestRunResult>;

export const TestRunResultCompact = TestRunResult.pick({
  status: true,
  test_run_id: true,
  diff: true,
  assertions: true,
}).strip();
export type TestRunResultCompact = z.infer<typeof TestRunResultCompact>;

export const testRunResultView: ResourceView<TestRunResult> = {
  compactPick: TestRunResultCompact,
  tableColumns: [
    { key: "status", label: "Status" },
    { key: "test_run_id", label: "Run ID" },
  ],
};

export const AssertionResultCompact = AssertionResult.pick({
  name: true,
  status: true,
  failing_row_count: true,
}).strip();
export type AssertionResultCompact = z.infer<typeof AssertionResultCompact>;

export const assertionResultView: ResourceView<AssertionResult> = {
  compactPick: AssertionResultCompact,
  tableColumns: [
    { key: "name", label: "Name" },
    { key: "status", label: "Status" },
    { key: "failing_row_count", label: "Failing Rows" },
  ],
};
