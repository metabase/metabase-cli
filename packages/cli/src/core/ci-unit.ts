import {
  type TransformTestRefusalCode,
  type TransformTestRunResult,
  isTransformTestCode,
} from "@metabase/client/domain/transform-test";
import { NetworkError, ResponseShapeError, TimeoutError } from "@metabase/client/errors";
import { HttpError, isHttpNotFound } from "@metabase/client/http/errors";
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

// Metabase refuses a test it will not run with a `transform-test.*` code. A code newer than this
// client is still a refusal, unlike a network or server failure.
export function testRefusal(error: unknown): TestRefusal | null {
  if (
    !(error instanceof HttpError) ||
    error.errorCode === null ||
    !isTransformTestCode(error.errorCode)
  ) {
    return null;
  }
  return {
    error_code: error.errorCode,
    message: error.serverMessage ?? error.message,
    tables: error.tables,
  };
}

// Metabase could not run the transform under test, or could not parse its source: the change is
// the likelier cause. Every other refusal, known to this client or not, refuses the test.
const CHANGE_FAILURE_CODES: ReadonlySet<string> = new Set([
  "transform-test.transform-failed",
  "transform-test.unparseable-source",
] satisfies TransformTestRefusalCode[]);

export function refusalVerdict(refusal: TestRefusal): Extract<Verdict, "failed" | "refused"> {
  return CHANGE_FAILURE_CODES.has(refusal.error_code) ? "failed" : "refused";
}

// A check the CLI refuses on its own account.
export interface CiRefusal {
  error_code: string;
  message: string;
}

export const TRANSFORM_NOT_ON_INSTANCE: CiRefusal = {
  error_code: "ci.transform-not-on-instance",
  message:
    "the transform is in the branch but not on the Metabase instance; load the branch into it first",
};

export const INVALID_ENTITY_ID: CiRefusal = {
  error_code: "ci.invalid-entity-id",
  message: "the transform's entity_id in the branch is not a valid entity id",
};

export const NO_TESTS_ON_INSTANCE: CiRefusal = {
  error_code: "ci.no-tests-on-instance",
  message:
    "the branch has a test for this transform, but the Metabase instance lists none, so no test ran; load the branch into it first",
};

const TRANSFORM_UNREADABLE: CiRefusal = {
  error_code: "ci.transform-unreadable",
  message:
    "the CI identity cannot read this transform, so Metabase hides its tests: reading it needs query permission on every table it reads",
};

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
// transform testing.
function sessionStop(error: unknown): StageStop | null {
  if (error instanceof CapabilityError) {
    return { code: "ci.unsupported-server", message: error.message };
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
    message: `no Metabase credential, so the transform tests did not run: ${error.message}`,
  };
}

// The requests the stage makes for one transform, in order.
export type TransformRequest = "read" | "list" | "run";

interface CheckFailure {
  kind: "check";
  verdict: Extract<Verdict, "failed" | "refused" | "error">;
  detail: TestRefusal | CiRefusal | RequestFailure;
}

interface StopFailure {
  kind: "stop";
  stop: StageStop;
}

export type UnitFailure = CheckFailure | StopFailure;

const REFUSAL_FOR_FORBIDDEN: Readonly<Record<TransformRequest, CiRefusal | null>> = {
  read: TRANSFORM_UNREADABLE,
  list: null,
  run: TEST_RUN_FORBIDDEN,
};

// Null means a bug or an interrupt, which the caller rethrows. A failed run costs that test alone,
// since the next run may succeed; a network failure before any run means the server is gone.
export function transformFailure(error: unknown, request: TransformRequest): UnitFailure | null {
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
    return { kind: "check", verdict: "refused", detail: TRANSFORM_NOT_ON_INSTANCE };
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
