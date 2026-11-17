import { isDataTestCode } from "@metabase/client/domain/data-test";
import type { TransformTestRunResult } from "@metabase/client/domain/transform-test";
import { NetworkError, ResponseShapeError, TimeoutError } from "@metabase/client/errors";
import { HttpError } from "@metabase/client/http/errors";
import { CapabilityError } from "@metabase/client/version/capability-error";

import type { StageStop, Verdict } from "./ci-events";
import { NotAuthenticatedError } from "./config";

type TestVerdict = TransformTestRunResult["status"];

// A failed expectation outranks one that errored: a failure is a finding about the change, an error
// a finding about the test. With neither, the run's own status decides.
export function testVerdict(result: TransformTestRunResult): TestVerdict {
  const statuses = new Set(result.expectations.map((expectation) => expectation.status));
  if (statuses.has("failed")) {
    return "failed";
  }
  if (statuses.has("error")) {
    return "error";
  }
  return result.status;
}

export interface TestRefusal {
  error_code: string;
  message: string;
  tables: string[] | null;
}

// Metabase refuses a test it will not run with a code its type prefixes (`card-test.*`). A code
// newer than this client is still a refusal, unlike a network or server failure.
export function testRefusal(error: unknown): TestRefusal | null {
  if (
    !(error instanceof HttpError) ||
    error.errorCode === null ||
    !isDataTestCode(error.errorCode)
  ) {
    return null;
  }
  return {
    error_code: error.errorCode,
    message: error.serverMessage ?? error.message,
    tables: error.tables,
  };
}

// Metabase could not run the query under test, or could not parse its source: the change is the
// likelier cause. Every test type prefixes the same names (`card-test.query-failed`), and Metabase 65
// names a query that would not run `transform-failed`. Every other refusal, known to this client or
// not, refuses the test.
const CHANGE_FAILURE_NAMES: ReadonlySet<string> = new Set([
  "query-failed",
  "transform-failed",
  "unparseable-source",
]);

const CODE_SEPARATOR = ".";

export function refusalVerdict(refusal: TestRefusal): Extract<Verdict, "failed" | "refused"> {
  const name = refusal.error_code.slice(refusal.error_code.indexOf(CODE_SEPARATOR) + 1);
  return CHANGE_FAILURE_NAMES.has(name) ? "failed" : "refused";
}

// A check the CLI refuses on its own account.
interface CiRefusal {
  error_code: string;
  message: string;
}

const TEST_RUN_FORBIDDEN: CiRefusal = {
  error_code: "ci.test-run-forbidden",
  message:
    "Metabase did not let the CI identity run this test: running a test needs write access to it, and a read-only remote-synced instance refuses everyone",
};

// A request that failed without a refusal. `status` is the HTTP status, or null when no answer came.
export interface RequestFailure {
  error_code: string;
  status: number | null;
  message: string;
}

// Null for anything else, such as a bug or an interrupt, which the caller rethrows.
function requestFailure(error: unknown): RequestFailure | null {
  if (error instanceof HttpError) {
    return { error_code: "ci.http-error", status: error.status, message: error.message };
  }
  if (error instanceof TimeoutError) {
    return { error_code: "ci.timeout", status: null, message: error.message };
  }
  if (error instanceof NetworkError) {
    return { error_code: "ci.network-error", status: null, message: error.message };
  }
  if (error instanceof ResponseShapeError) {
    return { error_code: "ci.unreadable-answer", status: null, message: error.message };
  }
  return null;
}

// Failures every later request would repeat: a credential Metabase rejects, or a server without
// the feature the request needs.
function sessionStop(error: unknown): StageStop | null {
  if (error instanceof CapabilityError) {
    return { code: "ci.unsupported-server", message: error.message };
  }
  if (error instanceof HttpError && error.kind === "auth") {
    return { code: "ci.unauthorized", message: error.message };
  }
  return null;
}

// A request every later check depends on stops the stage when it fails. Null means a bug or an interrupt, which the caller rethrows.
export function lookupStop(error: unknown): StageStop | null {
  const stop = sessionStop(error);
  if (stop !== null) {
    return stop;
  }
  const failure = requestFailure(error);
  return failure === null ? null : { code: failure.error_code, message: failure.message };
}

// With no credential, the stage stops before its first request, so the job still ends with
// `job.end` rather than a config error. `notDone` says what the stage did not do. Null for any
// other error, which the caller rethrows.
export function connectStop(error: unknown, notDone: string): StageStop | null {
  if (!(error instanceof NotAuthenticatedError)) {
    return null;
  }
  return {
    code: "ci.no-credential",
    message: `no Metabase credential, so ${notDone}: ${error.message}`,
  };
}

// The requests the stage makes for each test type, in order.
export type TestRequest = "list" | "run";

interface CheckFailure {
  kind: "check";
  verdict: Extract<Verdict, "failed" | "refused" | "error">;
  detail: TestRefusal | CiRefusal | RequestFailure;
}

interface StopFailure {
  kind: "stop";
  stop: StageStop;
}

type UnitFailure = CheckFailure | StopFailure;

// Null means a bug or an interrupt, which the caller rethrows. A failed run costs that test alone,
// since the next run may succeed; a network failure before any run means the server is gone.
export function testFailure(error: unknown, request: TestRequest): UnitFailure | null {
  const stop = sessionStop(error);
  if (stop !== null) {
    return { kind: "stop", stop };
  }
  const refusal = request === "run" ? testRefusal(error) : null;
  if (refusal !== null) {
    return { kind: "check", verdict: refusalVerdict(refusal), detail: refusal };
  }
  const forbidden = error instanceof HttpError && error.kind === "forbidden";
  if (forbidden && request === "run") {
    return { kind: "check", verdict: "refused", detail: TEST_RUN_FORBIDDEN };
  }
  const failure = requestFailure(error);
  if (failure === null) {
    return null;
  }
  if (error instanceof NetworkError && request === "list") {
    return { kind: "stop", stop: { code: failure.error_code, message: failure.message } };
  }
  return { kind: "check", verdict: "error", detail: failure };
}

// A server without a test type, or without its route yet, holds no test of it.
export function isUnsupportedTestType(error: unknown): error is CapabilityError | HttpError {
  return (
    error instanceof CapabilityError ||
    (error instanceof HttpError && error.kind === "route-missing")
  );
}
