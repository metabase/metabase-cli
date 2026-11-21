import { isDataTestCode } from "@metabase/client/domain/data-test";
import type { DataTestRunResult } from "@metabase/client/domain/data-test";
import { NetworkError, ResponseShapeError, TimeoutError } from "@metabase/client/errors";
import { HttpError, isHttpNotFound } from "@metabase/client/http/errors";
import { CapabilityError } from "@metabase/client/version/capability-error";

import type { StageStop, Verdict } from "./ci-events";
import { NotAuthenticatedError } from "./config";

type TestVerdict = DataTestRunResult["status"];

// A failed expectation outranks one that errored: a failure is a finding about the change, an error
// a finding about the test. With neither, the run's own status decides.
export function testVerdict(result: DataTestRunResult): TestVerdict {
  const statuses = new Set(result.expectations.map((expectation) => expectation.status));
  if (statuses.has("failed")) {
    return "failed";
  }
  if (statuses.has("error")) {
    return "error";
  }
  return result.status;
}

interface TestRefusal {
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
export interface CiRefusal {
  error_code: string;
  message: string;
}

export const ENTITY_NOT_ON_INSTANCE: CiRefusal = {
  error_code: "ci.entity-not-on-instance",
  message:
    "the entity is in the branch but not on the Metabase instance; load the branch into it first",
};

export const INVALID_ENTITY_ID: CiRefusal = {
  error_code: "ci.invalid-entity-id",
  message: "the entity's entity_id in the branch is not a valid entity id",
};

export const NO_TESTS_ON_INSTANCE: CiRefusal = {
  error_code: "ci.no-tests-on-instance",
  message:
    "the branch has a test for this entity, but the Metabase instance lists none, so no test ran; load the branch into it first",
};

export const TYPE_NOT_ON_INSTANCE: CiRefusal = {
  error_code: "ci.test-type-unsupported",
  message:
    "the branch has a test for this entity, but the Metabase instance cannot run tests of its type, so no test ran",
};

const ENTITY_UNREADABLE: CiRefusal = {
  error_code: "ci.entity-unreadable",
  message:
    "the CI identity cannot read this entity, so Metabase hides its tests: reading it needs query permission on every table it reads",
};

const TEST_RUN_FORBIDDEN: CiRefusal = {
  error_code: "ci.test-run-forbidden",
  message:
    "Metabase did not let the CI identity run this test: running a test needs write access to it, and a read-only remote-synced instance refuses everyone",
};

// A request that failed without a refusal. `status` is the HTTP status, or null when no answer came.
interface RequestFailure {
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

// A request every later check depends on stops the stage when it fails. Null means a bug or an
// interrupt, which the caller rethrows.
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

// The requests the stage makes, in order: reading a changed entity, listing tests, running one.
export type TestRequest = "read" | "list" | "run";

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

const REFUSAL_FOR_FORBIDDEN: Readonly<Record<TestRequest, CiRefusal | null>> = {
  read: ENTITY_UNREADABLE,
  list: null,
  run: TEST_RUN_FORBIDDEN,
};

// Null means a bug or an interrupt, which the caller rethrows. A failed run costs that test alone,
// since the next run may succeed; a network failure before a run means the server is gone.
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
  const forbiddenRefusal = forbidden ? REFUSAL_FOR_FORBIDDEN[request] : null;
  if (forbiddenRefusal !== null) {
    return { kind: "check", verdict: "refused", detail: forbiddenRefusal };
  }
  if (request === "read" && isHttpNotFound(error)) {
    return { kind: "check", verdict: "refused", detail: ENTITY_NOT_ON_INSTANCE };
  }
  const failure = requestFailure(error);
  if (failure === null) {
    return null;
  }
  if (error instanceof NetworkError && request !== "run") {
    return { kind: "stop", stop: { code: failure.error_code, message: failure.message } };
  }
  return { kind: "check", verdict: "error", detail: failure };
}
