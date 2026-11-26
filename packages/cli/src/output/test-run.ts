import {
  type DataTestExpectationResult,
  type DataTestRunDetail,
  DataTestRunRefusal,
  type DataTestRunResult,
} from "@metabase/client/domain/data-test";

import { testKind } from "../core/data-test";
import { pluralize } from "./pluralize";
import { printable } from "./table";

type ExpectationStatus = DataTestExpectationResult["status"];

function namesOf(expectations: DataTestExpectationResult[], status: ExpectationStatus): string[] {
  return expectations
    .filter((expectation) => expectation.status === status)
    .map((e) => printable(e.name));
}

export function testRunSummary(label: string, result: DataTestRunResult): string {
  if (result.status === "passed") {
    const count = pluralize(result.expectations.length, "expectation", "expectations");
    return `${label} passed ${count}.`;
  }
  const failed = namesOf(result.expectations, "failed");
  const errored = namesOf(result.expectations, "error");
  const parts = [
    failed.length > 0 ? `failed: ${failed.join(", ")}` : null,
    errored.length > 0 ? `could not run: ${errored.join(", ")}` : null,
  ].filter((part) => part !== null);
  if (parts.length === 0) {
    return `${label} ${result.status}.`;
  }
  return `${label} ${result.status} — ${parts.join("; ")}.`;
}

type StoredResult = NonNullable<DataTestRunDetail["result"]>;

function isRefusal(result: StoredResult): result is DataTestRunRefusal {
  return DataTestRunRefusal.safeParse(result).success;
}

function testLabel(run: DataTestRunDetail): string {
  const kind = testKind(run.test_type);
  return run.test_id === null ? kind : `${kind}:${run.test_id}`;
}

export function storedResultSummary(run: DataTestRunDetail): string {
  if (run.result === null) {
    return run.can_read_result ? "none stored" : "withheld from this user";
  }
  if (isRefusal(run.result)) {
    return `${run.result.message} (${run.result["error-code"]})`;
  }
  return testRunSummary(testLabel(run), run.result);
}
