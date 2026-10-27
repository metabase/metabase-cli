import { describe, expect, it } from "vitest";

import {
  type TransformTestExpectationResult,
  type TransformTestRunResult,
  TransformTestRefusalCode,
} from "@metabase/client/domain/transform-test";
import {
  AbortError,
  InternalError,
  NetworkError,
  ResponseShapeError,
  TimeoutError,
} from "@metabase/client/errors";
import { HttpError } from "@metabase/client/http/errors";
import { CapabilityError } from "@metabase/client/version/capability-error";

import {
  type TransformRequest,
  lookupStop,
  refusalVerdict,
  testRefusal,
  testVerdict,
  transformFailure,
} from "./ci-unit";

type ExpectationStatus = TransformTestExpectationResult["status"];

const EXPECTATION_BY_STATUS: Record<ExpectationStatus, TransformTestExpectationResult> = {
  passed: { name: "e", type: "empty", status: "passed" },
  failed: { name: "e", type: "empty", status: "failed", columns: [], sample: [], truncated: 0 },
  error: {
    name: "e",
    type: "empty",
    status: "error",
    error: { type: "expectation-failed", message: "broke" },
  },
};

// Server-shaped: Metabase answers `passed` exactly when every expectation passed.
function runResult(statuses: readonly ExpectationStatus[]): TransformTestRunResult {
  return {
    status: statuses.every((status) => status === "passed") ? "passed" : "failed",
    tables: {},
    expectations: statuses.map((status) => EXPECTATION_BY_STATUS[status]),
  };
}

function httpError(status: number, statusText: string, body: string): HttpError {
  return new HttpError({
    status,
    statusText,
    method: "POST",
    url: "https://m.example.com/api/ee/transform-test/7/run",
    responseHeaders: { "content-type": "application/json" },
    rawBody: body,
  });
}

function refusalError(errorCode: string): HttpError {
  return httpError(400, "Bad Request", JSON.stringify({ message: "m", "error-code": errorCode }));
}

describe("testVerdict", () => {
  it("passes a test whose expectations all passed", () => {
    expect(testVerdict(runResult(["passed", "passed"]))).toBe("passed");
  });

  it("fails a test with a failed expectation", () => {
    expect(testVerdict(runResult(["passed", "failed"]))).toBe("failed");
  });

  it("reports an error when an expectation's own query broke and none failed", () => {
    expect(testVerdict(runResult(["passed", "error"]))).toBe("error");
  });

  it("lets a failed expectation outrank an errored one, whichever comes first", () => {
    expect([
      testVerdict(runResult(["failed", "error"])),
      testVerdict(runResult(["error", "failed"])),
    ]).toEqual(["failed", "failed"]);
  });

  it("takes the run's own status when no expectation failed or errored", () => {
    expect(testVerdict({ ...runResult(["passed"]), status: "failed" })).toBe("failed");
  });
});

describe("testRefusal", () => {
  it("reads a typed transform-test refusal, with the tables it names", () => {
    const error = httpError(
      400,
      "Bad Request",
      JSON.stringify({
        message: "The transform reads public.orders with no input.",
        "error-code": "transform-test.missing-inputs",
        tables: ["public.orders"],
      }),
    );

    expect(testRefusal(error)).toEqual({
      error_code: "transform-test.missing-inputs",
      message: "The transform reads public.orders with no input.",
      tables: ["public.orders"],
    });
  });

  it("reads a transform-test code newer than the client as a refusal", () => {
    expect(testRefusal(refusalError("transform-test.some-new-refusal"))).toEqual({
      error_code: "transform-test.some-new-refusal",
      message: "m",
      tables: null,
    });
  });

  it("does not treat an error code outside transform-test.* as a refusal", () => {
    expect(testRefusal(refusalError("some-other.code"))).toBeNull();
  });

  it("does not treat an untyped server failure as a refusal", () => {
    expect(
      testRefusal(httpError(500, "Internal Server Error", JSON.stringify({ message: "boom" }))),
    ).toBeNull();
  });

  it("does not treat a non-HTTP error as a refusal", () => {
    expect(testRefusal(new Error("socket hang up"))).toBeNull();
  });
});

describe("refusalVerdict", () => {
  it("fails a test whose transform will not run or parse, since the change is the likelier cause", () => {
    expect(
      ["transform-test.transform-failed", "transform-test.unparseable-source"].map((code) =>
        refusalVerdict({ error_code: code, message: "m", tables: null }),
      ),
    ).toEqual(["failed", "failed"]);
  });

  it("refuses the test for every other refusal code, known to the client or not", () => {
    const changeFailures = new Set([
      "transform-test.transform-failed",
      "transform-test.unparseable-source",
    ]);
    const others = [
      ...TransformTestRefusalCode.options.filter((code) => !changeFailures.has(code)),
      "transform-test.some-new-refusal",
    ];

    expect(others).toHaveLength(TransformTestRefusalCode.options.length - changeFailures.size + 1);
    expect(
      others.map((code) => refusalVerdict({ error_code: code, message: "m", tables: null })),
    ).toEqual(others.map(() => "refused"));
  });
});

const UNAUTHORIZED = httpError(401, "Unauthorized", JSON.stringify({ message: "Unauthenticated" }));
const FORBIDDEN = httpError(403, "Forbidden", "You don't have permissions to do that.");
const SERVER_ERROR = httpError(500, "Internal Server Error", JSON.stringify({ message: "boom" }));
const RATE_LIMITED = httpError(429, "Too Many Requests", "slow down");
const NOT_FOUND = httpError(404, "Not Found", "Not found.");
const TIMED_OUT = new TimeoutError("Metabase did not answer within 120000 ms.", {
  kind: "http",
  method: "POST",
  url: "https://m.example.com/api/ee/transform-test/7/run",
  timeoutMs: 120_000,
});
const UNREACHABLE = new NetworkError("Could not reach Metabase.", {
  method: "GET",
  url: "https://m.example.com/api/ee/transform-test",
  cause: "ECONNREFUSED",
});
const UNLICENSED = new CapabilityError({
  reason: "missing-token-feature",
  detail: "transform testing",
  feature: "transformTests",
  since: 65,
  tokenFeature: "transforms-testing",
  serverVersion: "v1.65.0",
});

describe("transformFailure, a failure that ends the stage", () => {
  it("stops the stage when Metabase rejects the credential, whichever request it rejected", () => {
    const requests: TransformRequest[] = ["read", "list", "run"];

    expect(requests.map((request) => transformFailure(UNAUTHORIZED, request))).toEqual(
      requests.map(() => ({
        kind: "stop",
        stop: { code: "ci.unauthorized", message: UNAUTHORIZED.message },
      })),
    );
  });

  it("stops the stage when the server has no transform testing", () => {
    expect(transformFailure(UNLICENSED, "list")).toEqual({
      kind: "stop",
      stop: { code: "ci.unsupported-server", message: UNLICENSED.message },
    });
  });

  it("stops the stage when Metabase cannot be reached before any test runs", () => {
    expect([transformFailure(UNREACHABLE, "read"), transformFailure(UNREACHABLE, "list")]).toEqual(
      [0, 1].map(() => ({
        kind: "stop",
        stop: { code: "ci.network-error", message: UNREACHABLE.message },
      })),
    );
  });
});

describe("transformFailure, a failure that costs one check", () => {
  it("reports a run that failed without a refusal as an error, with the HTTP status", () => {
    expect(
      [SERVER_ERROR, RATE_LIMITED, NOT_FOUND].map((error) => transformFailure(error, "run")),
    ).toEqual(
      [SERVER_ERROR, RATE_LIMITED, NOT_FOUND].map((error) => ({
        kind: "check",
        verdict: "error",
        detail: { error_code: "ci.http-error", status: error.status, message: error.message },
      })),
    );
  });

  it("reports a run that timed out or lost its connection as an error with no status", () => {
    expect([transformFailure(TIMED_OUT, "run"), transformFailure(UNREACHABLE, "run")]).toEqual([
      {
        kind: "check",
        verdict: "error",
        detail: { error_code: "ci.timeout", status: null, message: TIMED_OUT.message },
      },
      {
        kind: "check",
        verdict: "error",
        detail: { error_code: "ci.network-error", status: null, message: UNREACHABLE.message },
      },
    ]);
  });

  it("reports an answer the client cannot read as an error", () => {
    const unreadable = new ResponseShapeError("Metabase answered an unexpected shape.", {
      kind: "decoded",
      source: "transform test run",
      value: null,
    });

    expect(transformFailure(unreadable, "run")).toEqual({
      kind: "check",
      verdict: "error",
      detail: { error_code: "ci.unreadable-answer", status: null, message: unreadable.message },
    });
  });

  it("refuses a transform the CI identity cannot read, naming the permission", () => {
    expect(transformFailure(FORBIDDEN, "read")).toEqual({
      kind: "check",
      verdict: "refused",
      detail: {
        error_code: "ci.transform-unreadable",
        message:
          "the CI identity cannot read this transform, so Metabase hides its tests: reading it needs query permission on every table it reads",
      },
    });
  });

  it("refuses a test the CI identity may not run, naming the permission", () => {
    expect(transformFailure(FORBIDDEN, "run")).toEqual({
      kind: "check",
      verdict: "refused",
      detail: {
        error_code: "ci.test-run-forbidden",
        message:
          "Metabase did not let the CI identity run this test: running a test needs write access to it, and a read-only remote-synced instance refuses everyone",
      },
    });
  });

  it("refuses a transform that left the instance after its lookup", () => {
    expect(transformFailure(NOT_FOUND, "read")).toEqual({
      kind: "check",
      verdict: "refused",
      detail: {
        error_code: "ci.transform-not-on-instance",
        message:
          "the transform is in the branch but not on the Metabase instance; load the branch into it first",
      },
    });
  });

  it("gives a run refusal its verdict", () => {
    expect(transformFailure(refusalError("transform-test.transform-failed"), "run")).toEqual({
      kind: "check",
      verdict: "failed",
      detail: { error_code: "transform-test.transform-failed", message: "m", tables: null },
    });
  });

  it("reads a transform-test code only on a run", () => {
    expect(transformFailure(refusalError("transform-test.unused-inputs"), "list")).toEqual({
      kind: "check",
      verdict: "error",
      detail: { error_code: "ci.http-error", status: 400, message: "m" },
    });
  });
});

describe("transformFailure and lookupStop leave a bug or an interrupt to the caller", () => {
  it("answers null for an interrupt or a bug", () => {
    const interrupt = new AbortError();
    const bug = new InternalError("no lookup");

    expect([
      transformFailure(interrupt, "run"),
      transformFailure(bug, "run"),
      lookupStop(interrupt),
      lookupStop(bug),
    ]).toEqual([null, null, null, null]);
  });
});

describe("lookupStop", () => {
  it("stops the stage on any failure of the entity-id lookup, since every transform needs it", () => {
    expect([lookupStop(SERVER_ERROR), lookupStop(TIMED_OUT), lookupStop(UNAUTHORIZED)]).toEqual([
      { code: "ci.http-error", message: SERVER_ERROR.message },
      { code: "ci.timeout", message: TIMED_OUT.message },
      { code: "ci.unauthorized", message: UNAUTHORIZED.message },
    ]);
  });
});
