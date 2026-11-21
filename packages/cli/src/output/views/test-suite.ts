import {
  type TestSuite,
  TestSuiteCompact,
  TestSuiteRun,
  type TestSuiteRunEntry,
  type TestSuiteRunRecord,
  TestSuiteRunRecordCompact,
} from "@metabase/client/domain/test-suite";

import { pluralize } from "../pluralize";
import { printable } from "../table";
import type { ResourceView } from "../view";

export const testSuiteView: ResourceView<TestSuite> = {
  compactPick: TestSuiteCompact,
  tableColumns: [
    { key: "id", label: "ID" },
    { key: "name", label: "Name" },
    { key: "description", label: "Description" },
    { key: "members", label: "Members", value: (suite) => suite.members.length },
  ],
};

export const testSuiteRunView: ResourceView<TestSuiteRun> = {
  compactPick: TestSuiteRun,
  tableColumns: [
    { key: "id", label: "Run ID" },
    { key: "suite_id", label: "Suite" },
    { key: "status", label: "Status" },
  ],
};

export const testSuiteRunRecordView: ResourceView<TestSuiteRunRecord> = {
  compactPick: TestSuiteRunRecordCompact,
  tableColumns: [
    { key: "id", label: "Run ID" },
    { key: "status", label: "Status" },
    { key: "start_time", label: "Started" },
    { key: "end_time", label: "Ended" },
    { key: "initiated_by", label: "Started by" },
  ],
};

// A member the runner cannot read has no id or name, so it is named by its entity id.
function memberLabel(member: TestSuiteRunEntry): string {
  const type = printable(member.test_type);
  const ref =
    member.test_id === undefined
      ? `${type} test ${printable(member.test_entity_id)}`
      : `${type}-test:${member.test_id}`;
  return member.name === undefined ? ref : `${ref} "${printable(member.name)}"`;
}

function memberLine(member: TestSuiteRunEntry): string {
  const line = `  ${member.status} ${memberLabel(member)}`;
  const message = member.error?.message;
  return message === undefined || message === null ? line : `${line}: ${printable(message)}`;
}

function suiteRunHeadline(label: string, run: TestSuiteRun): string {
  const members = pluralize(run.members.length, "member", "members");
  if (run.status === "passed") {
    return `${label} passed ${members}.`;
  }
  if (run.status === "timeout") {
    return `${label} timed out.`;
  }
  const notPassed = run.members.filter((member) => member.status !== "passed").length;
  return `${label} failed: ${notPassed} of ${members} did not pass.`;
}

export function testSuiteRunSummary(label: string, run: TestSuiteRun): string {
  return [suiteRunHeadline(label, run), ...run.members.map(memberLine)].join("\n");
}
