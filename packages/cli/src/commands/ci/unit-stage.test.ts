import { afterEach, describe, expect, it, vi } from "vitest";

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

import { type CheckedTransform, type CiEventBody, runStages } from "../../core/ci-events";
import { interruptSignal } from "../../runtime/interrupt";

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

function refusal(errorCode: string, message: string): HttpError {
  return httpError(400, "Bad Request", JSON.stringify({ message, "error-code": errorCode }));
}

const SERVER_ERROR = httpError(500, "Internal Server Error", JSON.stringify({ message: "boom" }));
const UNAUTHORIZED = httpError(401, "Unauthorized", JSON.stringify({ message: "Unauthenticated" }));

function port(overrides: Partial<UnitStagePort>): UnitStagePort {
  return {
    lookUpTransforms: async () => new Map([[DAILY.entity_id, { kind: "found", id: 3 }]]),
    readTransform: async () => {},
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
  verdict: "passed" | "failed" | "error" | "refused",
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
        tables: null,
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
        tables: null,
      }),
    ]);
  });

  it("rethrows an error outside the client's failures, since it is a bug", async () => {
    const bug = new Error("undefined is not a function");

    await expect(reports([DAILY], port({ runTest: async () => Promise.reject(bug) }))).rejects.toBe(
      bug,
    );
  });

  it("refuses a transform the CI identity cannot read, rather than passing it as untested", async () => {
    const listed: number[] = [];
    const bodies = await reports(
      [DAILY],
      port({
        readTransform: async () =>
          Promise.reject(httpError(403, "Forbidden", "You don't have permissions to do that.")),
        listTests: async (transformId) => {
          listed.push(transformId);
          return [];
        },
      }),
    );

    expect(listed).toEqual([]);
    expect(bodies).toEqual([
      testCheck(DAILY.entity_id, "Daily", "refused", {
        error_code: "ci.transform-unreadable",
        message:
          "the CI identity cannot read this transform, so Metabase hides its tests: reading it needs query permission on every table it reads",
      }),
    ]);
  });

  it("reports a run that failed with a 500 as an error check, and runs the next test", async () => {
    const bodies = await reports(
      [DAILY],
      port({
        runTest: async (testId) => (testId === 4 ? Promise.reject(SERVER_ERROR) : PASSED_RUN),
      }),
    );

    expect(bodies).toEqual([
      testCheck("4", "Daily: first", "error", {
        error_code: "ci.http-error",
        status: 500,
        message: SERVER_ERROR.message,
      }),
      testCheck("9", "Daily: second", "passed", PASSED_RUN),
    ]);
  });

  it("stops at a rejected credential, keeping the checks already reported", async () => {
    const ran: number[] = [];
    const stage = unitStage([DAILY], async () =>
      port({
        runTest: async (testId) => {
          ran.push(testId);
          return testId === 9 ? Promise.reject(UNAUTHORIZED) : PASSED_RUN;
        },
        listTests: async () => [
          transformTest(4, "first"),
          transformTest(9, "second"),
          transformTest(12, "third"),
        ],
      }),
    );
    const bodies: CiEventBody[] = [];

    const outcome = await runStages([stage], (body) => bodies.push(body));

    expect(ran).toEqual([4, 9]);
    expect(outcome).toEqual({ state: "errored", checks: 1, warnings: 0 });
    expect(bodies).toEqual([
      { type: "stage.start", stage: "unit" },
      testCheck("4", "Daily: first", "passed", PASSED_RUN),
      {
        type: "stage.end",
        stage: "unit",
        status: "errored",
        stopped: { code: "ci.unauthorized", message: UNAUTHORIZED.message },
      },
    ]);
  });

  it("stops before any check when the entity-id lookup fails", async () => {
    const stopped = await unitStage([DAILY], async () =>
      port({ lookUpTransforms: async () => Promise.reject(SERVER_ERROR) }),
    ).run(() => {
      throw new Error("no check expected");
    });

    expect(stopped).toEqual({ code: "ci.http-error", message: SERVER_ERROR.message });
  });

  it("looks every checked transform up in one request", async () => {
    const asked: string[][] = [];
    const other: CheckedTransform = { entity_id: "BBBBBBBBBBBBBBBBBBBBB", name: "Other" };

    await reports(
      [DAILY, other],
      port({
        lookUpTransforms: async (entityIds) => {
          asked.push([...entityIds]);
          return new Map(entityIds.map((entityId) => [entityId, { kind: "not-found" }]));
        },
      }),
    );

    expect(asked).toEqual([[DAILY.entity_id, other.entity_id]]);
  });

  it("checks transforms in checked order, and each transform's tests in id order", async () => {
    const early: CheckedTransform = { entity_id: "AAAAAAAAAAAAAAAAAAAAA", name: "Early" };
    const late: CheckedTransform = { entity_id: "BBBBBBBBBBBBBBBBBBBBB", name: "Late" };
    const bodies = await reports(
      [late, early],
      port({
        lookUpTransforms: async () =>
          new Map([
            [early.entity_id, { kind: "found", id: 1 }],
            [late.entity_id, { kind: "found", id: 2 }],
          ]),
        listTests: async (transformId) =>
          transformId === 1
            ? [transformTest(6, "b"), transformTest(5, "a")]
            : [transformTest(8, "d"), transformTest(7, "c")],
      }),
    );

    expect(bodies).toEqual([
      testCheck("7", "Late: c", "passed", PASSED_RUN),
      testCheck("8", "Late: d", "passed", PASSED_RUN),
      testCheck("5", "Early: a", "passed", PASSED_RUN),
      testCheck("6", "Early: b", "passed", PASSED_RUN),
    ]);
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

afterEach(() => {
  vi.restoreAllMocks();
});

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

  it("reads a transform by its numeric id", async () => {
    const capture = captureFetch([
      jsonResponse({ version: { tag: "v1.64.0" }, "token-features": { transforms: true } }),
      jsonResponse({
        id: 3,
        name: "Daily",
        description: null,
        source: {
          type: "query",
          query: { database: 1, type: "native", native: { query: "select 1" } },
        },
        target: { type: "table", database: 1, schema: "public", name: "daily" },
        source_type: "native",
        entity_id: DAILY.entity_id,
        created_at: "2026-10-30T12:00:00Z",
        updated_at: "2026-10-30T12:00:00Z",
        creator_id: 1,
        collection_id: null,
        target_table_id: null,
      }),
    ]);
    const client = createClient(CREDENTIALS, {
      userAgent: TEST_USER_AGENT,
      fetchImpl: capture.fetch,
    });

    await clientPort(client).readTransform(3);

    expect(capture.calls.map((call) => [call.method, call.url])).toEqual([
      ["GET", "https://mb.example.com/api/session/properties"],
      ["GET", "https://mb.example.com/api/transform/3"],
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

  it("throws an InternalError on an eid answer outside the server's contract", async () => {
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

  it("runs each test with the 120 s per-test timeout and the interrupt signal", async () => {
    const client = createClient(CREDENTIALS, {
      userAgent: TEST_USER_AGENT,
      fetchImpl: captureFetch([jsonResponse(PASSED_RUN)]).fetch,
    });
    const run = vi.spyOn(client.transformTest, "run");

    await clientPort(client).runTest(4);

    expect(run.mock.calls).toEqual([[4, { timeoutMs: 120_000, signal: interruptSignal }]]);
  });

  it("arms the request timer with 120000 ms, not the transport's 30000 ms default", async () => {
    const client = createClient(CREDENTIALS, {
      userAgent: TEST_USER_AGENT,
      fetchImpl: captureFetch([jsonResponse(PASSED_RUN)]).fetch,
    });
    const timeout = vi.spyOn(AbortSignal, "timeout");

    await clientPort(client).runTest(4);

    expect(timeout.mock.calls).toEqual([[120_000]]);
  });

  it("hands the interrupt signal to the lookup and the test list", async () => {
    const client = createClient(CREDENTIALS, {
      userAgent: TEST_USER_AGENT,
      fetchImpl: captureFetch([
        jsonResponse({
          entity_ids: { [DAILY.entity_id]: { status: "ok", type: "transform", id: 3 } },
        }),
        jsonResponse([]),
      ]).fetch,
    });
    const translate = vi.spyOn(client.eidTranslation, "translate");
    const list = vi.spyOn(client.transformTest, "list");
    const stagePort = clientPort(client);

    await stagePort.lookUpTransforms([DAILY.entity_id]);
    await stagePort.listTests(3);

    expect([translate.mock.calls[0]?.[1], list.mock.calls[0]?.[1]]).toEqual([
      { signal: interruptSignal },
      { signal: interruptSignal },
    ]);
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
