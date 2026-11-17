import type {
  TransformTestExpectationResult,
  TransformTestRunResult,
} from "@metabase/client/domain/transform-test";

type ExpectationStatus = TransformTestExpectationResult["status"];

function namesOf(
  expectations: TransformTestExpectationResult[],
  status: ExpectationStatus,
): string[] {
  return expectations.filter((expectation) => expectation.status === status).map((e) => e.name);
}

export function testRunSummary(label: string, result: TransformTestRunResult): string {
  if (result.status === "passed") {
    return `${label} passed ${result.expectations.length} expectation(s).`;
  }
  const failed = namesOf(result.expectations, "failed");
  const errored = namesOf(result.expectations, "error");
  const parts = [
    failed.length > 0 ? `failed: ${failed.join(", ")}` : null,
    errored.length > 0 ? `could not run: ${errored.join(", ")}` : null,
  ].filter((part) => part !== null);
  return `${label} ${result.status} — ${parts.join("; ")}.`;
}
