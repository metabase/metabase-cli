import { describe, expect, it } from "vitest";

import {
  type TransformTestExpectationResult,
  type TransformTestRunResult,
  TransformTestRefusalCode,
} from "@metabase/client/domain/transform-test";
import { HttpError } from "@metabase/client/http/errors";

import { refusalVerdict, testRefusal, testVerdict } from "./ci-unit";

type ExpectationStatus = "passed" | "failed" | "error";

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

function runResult(statuses: readonly ExpectationStatus[]): TransformTestRunResult {
  return {
    status: "failed",
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

  it("lets a failed expectation outrank the errors that can follow it", () => {
    expect(testVerdict(runResult(["failed", "error", "error"]))).toBe("failed");
  });
});

describe("testRefusal", () => {
  it("reads a typed transform-test refusal", () => {
    const error = httpError(
      400,
      "Bad Request",
      JSON.stringify({
        message: "The transform reads public.orders with no input.",
        "error-code": "transform-test.missing-inputs",
      }),
    );

    expect(testRefusal(error)).toEqual({
      error_code: "transform-test.missing-inputs",
      message: "The transform reads public.orders with no input.",
    });
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
  it("fails a test whose transform will not run or parse, since the change broke it", () => {
    expect(
      ["transform-test.transform-failed", "transform-test.unparseable-source"].map((code) =>
        refusalVerdict({ error_code: TransformTestRefusalCode.parse(code), message: "m" }),
      ),
    ).toEqual(["failed", "failed"]);
  });

  it("refuses the test for every other refusal code the client knows", () => {
    const changeFailures = new Set([
      "transform-test.transform-failed",
      "transform-test.unparseable-source",
    ]);
    const others = TransformTestRefusalCode.options.filter((code) => !changeFailures.has(code));

    expect(others).toHaveLength(TransformTestRefusalCode.options.length - changeFailures.size);

    expect(others.map((code) => refusalVerdict({ error_code: code, message: "m" }))).toEqual(
      others.map(() => "refused"),
    );
  });
});
