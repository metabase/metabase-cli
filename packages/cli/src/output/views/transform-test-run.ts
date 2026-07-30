import {
  type AssertionResult,
  AssertionResultCompact,
  type TestRunInput,
  TestRunInputCompact,
  type TestRunResult,
  TestRunResultCompact,
} from "@metabase/client/domain/transform-test-run";

import type { ResourceView } from "../view";

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

export const testRunResultView: ResourceView<TestRunResult> = {
  compactPick: TestRunResultCompact,
  tableColumns: [{ key: "status", label: "Status" }],
};

export const assertionResultView: ResourceView<AssertionResult> = {
  compactPick: AssertionResultCompact,
  tableColumns: [
    { key: "name", label: "Name" },
    { key: "status", label: "Status" },
    { key: "failing_row_count", label: "Failing Rows" },
  ],
};
