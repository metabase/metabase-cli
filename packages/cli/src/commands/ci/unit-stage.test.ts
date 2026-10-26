import { describe, expect, it } from "vitest";

import { createClient } from "@metabase/client/client";
import type { TransformTest, TransformTestRunResult } from "@metabase/client/domain/transform-test";
import { InternalError } from "@metabase/client/errors";
import { HttpError } from "@metabase/client/http/errors";
import type { ClientCredentials } from "@metabase/client/http/transport";
import {
  captureFetch,
  jsonResponse,
  TEST_USER_AGENT,
} from "@metabase/client/testing/fetch-capture";

import type { CheckedTransform, CiEventBody } from "../../core/ci-events";

import { type UnitStagePort, clientPort, unitStage } from "./unit-stage";

const DAILY: CheckedTransform = { entity_id: "7JwIkkAG-06-nsl4jzsaq", name: "Daily" };

function transformTest(id: number, name: string): TransformTest {
  return {
    id,
    entity_id: `test-${id}`.padEnd(21, "x"),
    transform_id: 3,
    creator_id: 1,
    name,
    description: null,
    inputs: [],
    expectations: [],
    created_at: "2026-10-30T12:00:00Z",
    updated_at: "2026-10-30T12:00:00Z",
  };
}

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

function refusal(errorCode: string, message: string): HttpError {
  return new HttpError({
    status: 400,
    statusText: "Bad Request",
    method: "POST",
    url: "https://m.example.com/api/ee/transform-test/4/run",
    responseHeaders: { "content-type": "application/json" },
    rawBody: JSON.stringify({ message, "error-code": errorCode }),
  });
}

function port(overrides: Partial<UnitStagePort>): UnitStagePort {
  return {
    lookUpTransforms: async () => new Map([[DAILY.entity_id, { kind: "found", id: 3 }]]),
    listTests: async () => [transformTest(9, "second"), transformTest(4, "first")],
    runTest: async () => PASSED_RUN,
    nowMs: () => 0,
    ...overrides,
  };
}

async function reports(
  checked: readonly CheckedTransform[],
  stagePort: UnitStagePort,
): Promise<CiEventBody[]> {
  const bodies: CiEventBody[] = [];
  await unitStage(checked, async () => stagePort).run((check) =>
    bodies.push({ type: "check.result", stage: "unit", ...check }),
  );
  return bodies;
}

function testCheck(
  id: string,
  label: string,
  verdict: "passed" | "failed" | "refused",
  detail: unknown,
): CiEventBody {
  return {
    type: "check.result",
    stage: "unit",
    check: { kind: "transform-test", id, label },
    verdict,
    warnings: [],
    ms: 0,
    detail,
  };
}

describe("unitStage", () => {
  it("runs each test of each checked transform in id order, passing the result through", async () => {
    const ran: number[] = [];
    const bodies = await reports(
      [DAILY],
      port({
        runTest: async (testId) => {
          ran.push(testId);
          return testId === 9 ? FAILED_RUN : PASSED_RUN;
        },
      }),
    );

    expect(ran).toEqual([4, 9]);
    expect(bodies).toEqual([
      testCheck("4", "Daily: first", "passed", PASSED_RUN),
      testCheck("9", "Daily: second", "failed", FAILED_RUN),
    ]);
  });

  it("refuses a checked transform the instance does not have", async () => {
    const bodies = await reports(
      [DAILY],
      port({ lookUpTransforms: async () => new Map([[DAILY.entity_id, { kind: "not-found" }]]) }),
    );

    expect(bodies).toEqual([
      testCheck(DAILY.entity_id, "Daily", "refused", {
        error_code: "ci.transform-not-on-instance",
        message:
          "the transform is in the branch but not on the Metabase instance; load the branch into it first",
      }),
    ]);
  });

  it("refuses a checked transform whose entity_id is malformed, saying so rather than blaming the instance", async () => {
    const bodies = await reports(
      [DAILY],
      port({
        lookUpTransforms: async () => new Map([[DAILY.entity_id, { kind: "invalid-entity-id" }]]),
      }),
    );

    expect(bodies).toEqual([
      testCheck(DAILY.entity_id, "Daily", "refused", {
        error_code: "ci.invalid-entity-id",
        message: "the transform's entity_id in the branch is not a valid entity id",
      }),
    ]);
  });

  it("reports nothing for a transform with no tests, which the coverage check owns", async () => {
    expect(await reports([DAILY], port({ listTests: async () => [] }))).toEqual([]);
  });

  it("reports a test Metabase refuses to run, and keeps running the others", async () => {
    const refused = refusal("transform-test.unused-inputs", "Declared for a table it never reads.");
    const bodies = await reports(
      [DAILY],
      port({
        runTest: async (testId) => {
          if (testId === 4) {
            throw refused;
          }
          return PASSED_RUN;
        },
      }),
    );

    expect(bodies).toEqual([
      testCheck("4", "Daily: first", "refused", {
        error_code: "transform-test.unused-inputs",
        message: "Declared for a table it never reads.",
      }),
      testCheck("9", "Daily: second", "passed", PASSED_RUN),
    ]);
  });

  it("fails a test whose transform will not run, since the change broke it", async () => {
    const broken = refusal(
      "transform-test.transform-failed",
      "The transform under test failed to run.",
    );
    const bodies = await reports(
      [DAILY],
      port({
        listTests: async () => [transformTest(4, "first")],
        runTest: async () => Promise.reject(broken),
      }),
    );

    expect(bodies).toEqual([
      testCheck("4", "Daily: first", "failed", {
        error_code: "transform-test.transform-failed",
        message: "The transform under test failed to run.",
      }),
    ]);
  });

  it("lets a failure that is not a refusal end the job", async () => {
    const outage = new Error("socket hang up");

    await expect(
      reports([DAILY], port({ runTest: async () => Promise.reject(outage) })),
    ).rejects.toBe(outage);
  });

  it("measures each test's duration on the port's clock", async () => {
    let now = 100;
    const bodies = await reports(
      [DAILY],
      port({
        listTests: async () => [transformTest(4, "first")],
        nowMs: () => now,
        runTest: async () => {
          now += 250;
          return PASSED_RUN;
        },
      }),
    );

    expect(bodies).toEqual([{ ...testCheck("4", "Daily: first", "passed", PASSED_RUN), ms: 250 }]);
  });
});

const CREDENTIALS: ClientCredentials = {
  url: "https://mb.example.com",
  credential: { kind: "apiKey", apiKey: "mb_ci_test_key" },
};

describe("clientPort", () => {
  it("looks every transform up by entity_id, and answers for each one it asked about", async () => {
    const capture = captureFetch([
      jsonResponse({
        entity_ids: {
          "7JwIkkAG-06-nsl4jzsaq": { status: "ok", type: "transform", id: 3 },
          bad: { status: "invalid-format", type: "transform", reason: "wrong length" },
          XXXXXXXXXXXXXXXXXXXXX: { status: "not-found", type: "transform" },
        },
      }),
    ]);
    const client = createClient(CREDENTIALS, {
      userAgent: TEST_USER_AGENT,
      fetchImpl: capture.fetch,
    });

    const lookups = await clientPort(client).lookUpTransforms([
      "7JwIkkAG-06-nsl4jzsaq",
      "bad",
      "XXXXXXXXXXXXXXXXXXXXX",
    ]);

    expect([...lookups]).toEqual([
      ["7JwIkkAG-06-nsl4jzsaq", { kind: "found", id: 3 }],
      ["bad", { kind: "invalid-entity-id" }],
      ["XXXXXXXXXXXXXXXXXXXXX", { kind: "not-found" }],
    ]);
    expect(capture.calls.map((call) => [call.method, call.url, call.body])).toEqual([
      [
        "POST",
        "https://mb.example.com/api/eid-translation/translate",
        '{"entity_ids":{"transform":["7JwIkkAG-06-nsl4jzsaq","bad","XXXXXXXXXXXXXXXXXXXXX"]}}',
      ],
    ]);
  });

  it("lists a transform's tests by its numeric id", async () => {
    const capture = captureFetch([jsonResponse([transformTest(4, "first")])]);
    const client = createClient(CREDENTIALS, {
      userAgent: TEST_USER_AGENT,
      fetchImpl: capture.fetch,
    });

    expect(await clientPort(client).listTests(3)).toEqual([transformTest(4, "first")]);
    expect(capture.calls.map((call) => [call.method, call.url])).toEqual([
      ["GET", "https://mb.example.com/api/ee/transform-test?transform-id=3"],
    ]);
  });

  it("refuses an answer outside the server's contract rather than guessing", async () => {
    const capture = captureFetch([
      jsonResponse({
        entity_ids: { "7JwIkkAG-06-nsl4jzsaq": { status: "ok", type: "transform" } },
      }),
    ]);
    const client = createClient(CREDENTIALS, {
      userAgent: TEST_USER_AGENT,
      fetchImpl: capture.fetch,
    });
    const lookUp = clientPort(client).lookUpTransforms(["7JwIkkAG-06-nsl4jzsaq"]);

    await expect(lookUp).rejects.toThrow(InternalError);
    await expect(lookUp).rejects.toThrow(
      'eid translation answered 7JwIkkAG-06-nsl4jzsaq with {"status":"ok","type":"transform"}',
    );
  });

  it("runs a test by its id", async () => {
    const capture = captureFetch([jsonResponse(PASSED_RUN)]);
    const client = createClient(CREDENTIALS, {
      userAgent: TEST_USER_AGENT,
      fetchImpl: capture.fetch,
    });

    expect(await clientPort(client).runTest(4)).toEqual(PASSED_RUN);
    expect(capture.calls.map((call) => [call.method, call.url])).toEqual([
      ["POST", "https://mb.example.com/api/ee/transform-test/4/run"],
    ]);
  });
});
