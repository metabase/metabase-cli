import {
  type TransformTestRunResult,
  TransformTestRefusalCode,
} from "@metabase/client/domain/transform-test";
import { HttpError } from "@metabase/client/http/errors";

import type { Verdict } from "./ci-events";

type TestVerdict = "passed" | "failed" | "error";

// A failed expectation outranks one that errored: on some warehouses (Postgres) a failed statement
// aborts the transaction, so the expectations after it error because of it.
export function testVerdict(result: TransformTestRunResult): TestVerdict {
  const statuses = new Set(result.expectations.map((expectation) => expectation.status));
  if (statuses.has("failed")) {
    return "failed";
  }
  if (statuses.has("error")) {
    return "error";
  }
  return "passed";
}

export interface TestRefusal {
  error_code: TransformTestRefusalCode;
  message: string;
}

// Metabase refuses a test it cannot run (a wrong input, an unsupported driver) with a typed
// `transform-test.*` code; that is a verdict on the test, unlike a network or server failure.
export function testRefusal(error: unknown): TestRefusal | null {
  if (!(error instanceof HttpError)) {
    return null;
  }
  const code = TransformTestRefusalCode.safeParse(error.errorCode);
  if (!code.success) {
    return null;
  }
  return { error_code: code.data, message: error.serverMessage ?? error.message };
}

// These refusals mean the transform under test will not run or parse: the change is what broke.
const CHANGE_FAILURE_CODES: ReadonlySet<TransformTestRefusalCode> = new Set([
  "transform-test.transform-failed",
  "transform-test.unparseable-source",
]);

export function refusalVerdict(refusal: TestRefusal): Extract<Verdict, "failed" | "refused"> {
  return CHANGE_FAILURE_CODES.has(refusal.error_code) ? "failed" : "refused";
}
