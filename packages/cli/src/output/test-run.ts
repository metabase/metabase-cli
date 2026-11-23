import type {
  DataTestExpectationResult,
  DataTestRunResult,
} from "@metabase/client/domain/data-test";

import { pluralize } from "./pluralize";

type ExpectationStatus = DataTestExpectationResult["status"];

function namesOf(expectations: DataTestExpectationResult[], status: ExpectationStatus): string[] {
  return expectations.filter((expectation) => expectation.status === status).map((e) => e.name);
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
