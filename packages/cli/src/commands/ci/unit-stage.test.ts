import { describe, expect, it, vi } from "vitest";

import { createClient } from "@metabase/client/client";
import type { DataTestType } from "@metabase/client/domain/data-test";
import type { TransformTestRunResult } from "@metabase/client/domain/transform-test";
import { ConfigError } from "@metabase/client/errors";
import { HttpError } from "@metabase/client/http/errors";
import type { ClientCredentials } from "@metabase/client/http/transport";
import {
  captureFetch,
  jsonResponse,
  TEST_USER_AGENT,
} from "@metabase/client/testing/fetch-capture";
import { CapabilityError } from "@metabase/client/version/capability-error";

import type { CheckKind, CiEventBody, StageStop } from "../../core/ci-events";
import { NotAuthenticatedError } from "../../core/config";
import { interruptSignal } from "../../runtime/interrupt";

import { type InstanceTest, type UnitStagePort, clientPort, unitStage } from "./unit-stage";

const FAILED_RUN: TransformTestRunResult = {
  status: "failed",
  tables: {},
  expectations: [
    {
      name: "no negatives",
      type: "empty",
      status: "failed",
      columns: [],
      sample: [{ total: -1 }],
      truncated: 0,
    },
  ],
};

const PASSED_RUN: TransformTestRunResult = {
  status: "passed",
  tables: {},
  expectations: [{ name: "no negatives", type: "empty", status: "passed" }],
};

function httpError(status: number, statusText: string, body: string): HttpError {
  return new HttpError({
    status,
    statusText,
    method: "POST",
    url: "https://m.example.com/api/ee/transform-test/4/run",
    responseHeaders: { "content-type": "application/json" },
    rawBody: body,
  });
}

const SERVER_ERROR = httpError(500, "Internal Server Error", JSON.stringify({ message: "boom" }));
const UNAUTHORIZED = httpError(401, "Unauthorized", JSON.stringify({ message: "Unauthenticated" }));
const REFUSED = httpError(
  400,
  "Bad Request",
  JSON.stringify({ message: "no input for orders", "error-code": "card-test.missing-inputs" }),
);

function unsupported(type: DataTestType): CapabilityError {
  return new CapabilityError({
    reason: "version-too-old",
    detail: `no ${type} tests`,
    feature: "cardTests",
    since: 66,
    tokenFeature: "transforms-testing",
    serverVersion: "v1.65.0",
  });
}

const TESTS: Readonly<Record<DataTestType, readonly InstanceTest[]>> = {
  transform: [
    { id: 9, name: "second" },
    { id: 4, name: "first" },
  ],
  card: [{ id: 34, name: "revenue ignores refunds" }],
  segment: [],
  measure: [],
  action: [],
};

function port(overrides: Partial<UnitStagePort>): UnitStagePort {
  return {
    listTests: async (type) => TESTS[type],
    runTest: async () => PASSED_RUN,
    nowMs: () => 0,
    ...overrides,
  };
}

interface StageRun {
  checks: CiEventBody[];
  stopped: StageStop | null;
}

async function runStage(stagePort: UnitStagePort): Promise<StageRun> {
  const checks: CiEventBody[] = [];
  const stopped = await unitStage(async () => stagePort).run((check) =>
    checks.push({ type: "check.result", stage: "unit", ...check }),
  );
  return { checks, stopped };
}

function testCheck(
  kind: CheckKind,
  id: string,
  label: string,
  verdict: "passed" | "failed" | "error" | "refused",
  detail: unknown,
): CiEventBody {
  return {
    type: "check.result",
    stage: "unit",
    check: { kind, id, label },
    verdict,
    warnings: [],
    ms: 0,
    detail,
  };
}

describe("unitStage", () => {
  it("runs every test of every type, each type's tests in id order, passing the result through", async () => {
    expect(await runStage(port({}))).toEqual({
      checks: [
        testCheck("transform-test", "4", "first", "passed", PASSED_RUN),
        testCheck("transform-test", "9", "second", "passed", PASSED_RUN),
        testCheck("card-test", "34", "revenue ignores refunds", "passed", PASSED_RUN),
      ],
      stopped: null,
    });
  });

  it("leaves out a type the server does not support", async () => {
    const stagePort = port({
      listTests: async (type) => {
        if (type !== "transform") {
          throw unsupported(type);
        }
        return [{ id: 4, name: "first" }];
      },
    });

    expect(await runStage(stagePort)).toEqual({
      checks: [testCheck("transform-test", "4", "first", "passed", PASSED_RUN)],
      stopped: null,
    });
  });

  it("leaves out a type the server has no route for yet", async () => {
    const routeMissing = httpError(
      404,
      "Not Found",
      JSON.stringify("API endpoint does not exist."),
    );
    const stagePort = port({
      listTests: async (type) => {
        if (type !== "transform") {
          throw routeMissing;
        }
        return [{ id: 4, name: "first" }];
      },
    });

    expect(await runStage(stagePort)).toEqual({
      checks: [testCheck("transform-test", "4", "first", "passed", PASSED_RUN)],
      stopped: null,
    });
  });

  it("stops when the server supports no test type", async () => {
    const error = unsupported("transform");

    expect(
      await runStage(
        port({
          listTests: async () => {
            throw error;
          },
        }),
      ),
    ).toEqual({ checks: [], stopped: { code: "ci.unsupported-server", message: error.message } });
  });

  it("fails a test with a failed expectation", async () => {
    const stagePort = port({
      listTests: async (type) => (type === "transform" ? [{ id: 4, name: "first" }] : []),
      runTest: async () => FAILED_RUN,
    });

    expect((await runStage(stagePort)).checks).toEqual([
      testCheck("transform-test", "4", "first", "failed", FAILED_RUN),
    ]);
  });

  it("reports a test Metabase refuses to run, and keeps running the others", async () => {
    const stagePort = port({
      runTest: async (type) => {
        if (type === "card") {
          throw REFUSED;
        }
        return PASSED_RUN;
      },
    });

    expect((await runStage(stagePort)).checks).toEqual([
      testCheck("transform-test", "4", "first", "passed", PASSED_RUN),
      testCheck("transform-test", "9", "second", "passed", PASSED_RUN),
      testCheck("card-test", "34", "revenue ignores refunds", "refused", {
        error_code: "card-test.missing-inputs",
        message: "no input for orders",
        tables: null,
      }),
    ]);
  });

  it("reports a run that failed with a 500 as an error check, and runs the next test", async () => {
    const stagePort = port({
      runTest: async (type, testId) => {
        if (testId === 4) {
          throw SERVER_ERROR;
        }
        return PASSED_RUN;
      },
    });

    expect((await runStage(stagePort)).checks).toEqual([
      testCheck("transform-test", "4", "first", "error", {
        error_code: "ci.http-error",
        status: 500,
        message: SERVER_ERROR.message,
      }),
      testCheck("transform-test", "9", "second", "passed", PASSED_RUN),
      testCheck("card-test", "34", "revenue ignores refunds", "passed", PASSED_RUN),
    ]);
  });

  it("reports a type whose list failed with a 500 as an error check, and runs the other types", async () => {
    const stagePort = port({
      listTests: async (type) => {
        if (type === "transform") {
          throw SERVER_ERROR;
        }
        return TESTS[type];
      },
    });

    expect((await runStage(stagePort)).checks).toEqual([
      testCheck("transform-test", "transform", "transform tests", "error", {
        error_code: "ci.http-error",
        status: 500,
        message: SERVER_ERROR.message,
      }),
      testCheck("card-test", "34", "revenue ignores refunds", "passed", PASSED_RUN),
    ]);
  });

  it("stops at a rejected credential, keeping the checks already reported", async () => {
    const stagePort = port({
      runTest: async (_type, testId) => {
        if (testId === 9) {
          throw UNAUTHORIZED;
        }
        return PASSED_RUN;
      },
    });

    expect(await runStage(stagePort)).toEqual({
      checks: [testCheck("transform-test", "4", "first", "passed", PASSED_RUN)],
      stopped: { code: "ci.unauthorized", message: UNAUTHORIZED.message },
    });
  });

  it("rethrows an error outside the client's failures, since it is a bug", async () => {
    const bug = new TypeError("undefined is not a function");
    const stagePort = port({
      runTest: async () => {
        throw bug;
      },
    });

    await expect(runStage(stagePort)).rejects.toBe(bug);
  });

  it("measures each test's duration on the port's clock", async () => {
    let clock = 0;
    const stagePort = port({
      listTests: async (type) => (type === "transform" ? [{ id: 4, name: "first" }] : []),
      runTest: async () => {
        clock += 250;
        return PASSED_RUN;
      },
      nowMs: () => clock,
    });

    expect((await runStage(stagePort)).checks).toEqual([
      { ...testCheck("transform-test", "4", "first", "passed", PASSED_RUN), ms: 250 },
    ]);
  });

  it("does not connect when built, only when it runs", async () => {
    const connect = vi.fn(async () => port({}));
    const stage = unitStage(connect);

    expect(connect).not.toHaveBeenCalled();
    await stage.run(() => {});
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it("ends without a test run, saying why, when no Metabase credential is configured", async () => {
    const missing = new NotAuthenticatedError("no credential for https://mb.example.com");
    const stopped = await unitStage(async () => {
      throw missing;
    }).run(() => {});

    expect(stopped).toEqual({
      code: "ci.no-credential",
      message: `no Metabase credential, so the tests did not run: ${missing.message}`,
    });
  });

  it("rethrows any other config error from connecting", async () => {
    const config = new ConfigError("profile is bound to another URL");

    await expect(
      unitStage(async () => {
        throw config;
      }).run(() => {}),
    ).rejects.toBe(config);
  });
});

const CREDENTIALS: ClientCredentials = {
  url: "https://mb.example.com",
  credential: { kind: "apiKey", apiKey: "mb_wire_test_key" },
};

function clientOver(responses: Response[]) {
  const capture = captureFetch(responses);
  const client = createClient(CREDENTIALS, {
    userAgent: TEST_USER_AGENT,
    fetchImpl: capture.fetch,
  });
  return { client, capture };
}

describe("clientPort", () => {
  it("lists every transform test on the instance, of every transform", async () => {
    const { client, capture } = clientOver([jsonResponse([])]);

    await clientPort(client).listTests("transform");

    expect(capture.calls.map((call) => [call.method, call.url])).toEqual([
      ["GET", "https://mb.example.com/api/ee/transform-test"],
    ]);
  });

  it("runs a transform test with the 120 s per-test timeout and the interrupt signal", async () => {
    const { client } = clientOver([jsonResponse(PASSED_RUN)]);
    const run = vi.spyOn(client.transformTest, "run");

    await clientPort(client).runTest("transform", 4);

    expect(run.mock.calls).toEqual([[4, { timeoutMs: 120_000, signal: interruptSignal }]]);
  });

  it("runs a test of any other type the same way", async () => {
    const { client } = clientOver([jsonResponse(PASSED_RUN)]);
    const run = vi.spyOn(client.cardTest, "run");

    await clientPort(client).runTest("card", 34);

    expect(run.mock.calls).toEqual([[34, { timeoutMs: 120_000, signal: interruptSignal }]]);
  });
});
