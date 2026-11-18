import { type DataTestType, isDataTestCode } from "@metabase/client/domain/data-test";
import type { TransformTestRunResult } from "@metabase/client/domain/transform-test";
import { NetworkError, ResponseShapeError, TimeoutError } from "@metabase/client/errors";
import { HttpError, isHttpNotFound } from "@metabase/client/http/errors";
import { CapabilityError } from "@metabase/client/version/capability-error";

import type { StageStop, Verdict } from "./ci-events";
import { NotAuthenticatedError } from "./config";
import { isUnsupportedTestType } from "./data-test";

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

// Metabase refuses a test it will not run with a code that starts with the test's type, such as
// `transform-test.`, `card-test.` or `segment-test.`. A code newer than this client is still a refusal, unlike a
// network or server failure.
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

// Metabase could not run the query under test, or could not parse its source: the change is
// the likelier cause. Every other refusal, known to this client or not, refuses the test.
const CHANGE_FAILURE_NAMES: ReadonlySet<string> = new Set([
  "transform-failed",
  "query-failed",
  "unparseable-source",
]);

const CODE_SEPARATOR = ".";

export function refusalVerdict(refusal: TestRefusal): Extract<Verdict, "failed" | "refused"> {
  const code = refusal.error_code;
  const name = code.slice(code.indexOf(CODE_SEPARATOR) + CODE_SEPARATOR.length);
  return CHANGE_FAILURE_NAMES.has(name) ? "failed" : "refused";
}

// A check the CLI refuses on its own account.
export interface CiRefusal {
  error_code: string;
  message: string;
}

export function notOnInstance(type: DataTestType): CiRefusal {
  return {
    error_code: `ci.${type}-not-on-instance`,
    message: `the ${type} is in the branch but not on the Metabase instance; load the branch into it first`,
  };
}

export function invalidEntityId(type: DataTestType): CiRefusal {
  return {
    error_code: "ci.invalid-entity-id",
    message: `the ${type}'s entity_id in the branch is not a valid entity id`,
  };
}

export function noTestsOnInstance(type: DataTestType): CiRefusal {
  return {
    error_code: "ci.no-tests-on-instance",
    message: `the branch has a test for this ${type}, but the Metabase instance lists none, so no test ran; load the branch into it first`,
  };
}

const READING_NEEDS: Readonly<Record<DataTestType, string>> = {
  transform: "reading it needs query permission on every table it reads",
  card: "reading it needs access to its collection",
  segment: "reading it needs access to its table",
};

function unreadable(type: DataTestType): CiRefusal {
  return {
    error_code: `ci.${type}-unreadable`,
    message: `the CI identity cannot read this ${type}, so Metabase hides its tests: ${READING_NEEDS[type]}`,
  };
}

const RUNNING_NEEDS: Readonly<Record<DataTestType, string>> = {
  transform:
    "running a test needs write access to it, and a read-only remote-synced instance refuses everyone",
  card: "running a card test needs permission to run the card's query and native query access to its database",
  segment:
    "running a segment test needs permission to run the segment's definition and native query access to its database",
};

function testRunForbidden(type: DataTestType): CiRefusal {
  return {
    error_code: "ci.test-run-forbidden",
    message: `Metabase did not let the CI identity run this test: ${RUNNING_NEEDS[type]}`,
  };
}

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
// transform testing.
function sessionStop(error: unknown): StageStop | null {
  if (error instanceof CapabilityError) {
    return { code: UNSUPPORTED_SERVER_CODE, message: error.message };
  }
  if (error instanceof HttpError && error.kind === "auth") {
    return { code: "ci.unauthorized", message: error.message };
  }
  return null;
}

// The entity-id lookup serves every checked transform, so any failure of it stops the stage. Null
// means a bug or an interrupt, which the caller rethrows.
export function lookupStop(error: unknown): StageStop | null {
  const stop = sessionStop(error);
  if (stop !== null) {
    return stop;
  }
  const failure = requestFailure(error);
  return failure === null ? null : { code: failure.error_code, message: failure.message };
}

// With no credential, the stage ends without a test run rather than ending the job, so the lint
// stage's findings still decide its state. Null for any other error, which the caller rethrows.
export function connectStop(error: unknown): StageStop | null {
  if (!(error instanceof NotAuthenticatedError)) {
    return null;
  }
  return {
    code: "ci.no-credential",
    message: `no Metabase credential, so the tests did not run: ${error.message}`,
  };
}

// The requests the stage makes for one entity, in order.
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

interface UnsupportedTypeFailure {
  kind: "unsupported-type";
  detail: CiRefusal;
}

export type UnitFailure = CheckFailure | StopFailure | UnsupportedTypeFailure;

function refusalForForbidden(request: TestRequest, type: DataTestType): CiRefusal | null {
  if (request === "read") {
    return unreadable(type);
  }
  return request === "run" ? testRunForbidden(type) : null;
}

const TYPE_EVERY_TESTING_SERVER_HAS: DataTestType = "transform";
const UNSUPPORTED_SERVER_CODE = "ci.unsupported-server";

function unsupportedType(
  error: unknown,
  request: TestRequest,
  type: DataTestType,
): UnsupportedTypeFailure | null {
  if (
    type === TYPE_EVERY_TESTING_SERVER_HAS ||
    request !== "list" ||
    !isUnsupportedTestType(error)
  ) {
    return null;
  }
  return {
    kind: "unsupported-type",
    detail: { error_code: UNSUPPORTED_SERVER_CODE, message: error.message },
  };
}

// Null means a bug or an interrupt, which the caller rethrows. A failed run costs that test alone,
// since the next run may succeed; a network failure before any run means the server is gone.
export function testFailure(
  error: unknown,
  request: TestRequest,
  type: DataTestType,
): UnitFailure | null {
  const unsupported = unsupportedType(error, request, type);
  if (unsupported !== null) {
    return unsupported;
  }
  const stop = sessionStop(error);
  if (stop !== null) {
    return { kind: "stop", stop };
  }
  const refusal = request === "run" ? testRefusal(error) : null;
  if (refusal !== null) {
    return { kind: "check", verdict: refusalVerdict(refusal), detail: refusal };
  }
  const forbidden = error instanceof HttpError && error.kind === "forbidden";
  const forbiddenRefusal = forbidden ? refusalForForbidden(request, type) : null;
  if (forbiddenRefusal !== null) {
    return { kind: "check", verdict: "refused", detail: forbiddenRefusal };
  }
  if (request === "read" && isHttpNotFound(error)) {
    return { kind: "check", verdict: "refused", detail: notOnInstance(type) };
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
