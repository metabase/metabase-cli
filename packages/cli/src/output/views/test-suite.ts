import { type TestSuite, TestSuiteCompact, TestSuiteRun } from "@metabase/client/domain/test-suite";

import type { ResourceView } from "../view";

export const testSuiteView: ResourceView<TestSuite> = {
  compactPick: TestSuiteCompact,
  tableColumns: [
    { key: "id", label: "ID" },
    { key: "name", label: "Name" },
    { key: "description", label: "Description" },
  ],
};

export const testSuiteRunView: ResourceView<TestSuiteRun> = {
  compactPick: TestSuiteRun,
  tableColumns: [{ key: "suite_id", label: "Suite" }],
};
