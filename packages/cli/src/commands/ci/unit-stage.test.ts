import { afterEach, describe, expect, it, vi } from "vitest";

import { createClient } from "@metabase/client/client";
import type { TransformTest, TransformTestRunResult } from "@metabase/client/domain/transform-test";
import { ConfigError, InternalError } from "@metabase/client/errors";
import { HttpError } from "@metabase/client/http/errors";
import { CapabilityError } from "@metabase/client/version/capability-error";
import type { ClientCredentials } from "@metabase/client/http/transport";
import {
  captureFetch,
  jsonResponse,
  TEST_USER_AGENT,
} from "@metabase/client/testing/fetch-capture";

import { entityKey } from "../../core/ci-affected";
import { type CheckedEntity, type CiEventBody, runStages } from "../../core/ci-events";
import { NotAuthenticatedError } from "../../core/config";
import { interruptSignal } from "../../runtime/interrupt";

import { type UnitStagePort, clientPort, unitStage } from "./unit-stage";

const DAILY: CheckedEntity = {
  type: "transform",
  entity_id: "7JwIkkAG-06-nsl4jzsaq",
  name: "Daily",
};

const BIG_ORDERS: CheckedEntity = {
  type: "card",
  entity_id: "Zq3kkAG-06-nsl4jzs1bV",
  name: "Big orders",
};

const NO_CARD_TESTS = new CapabilityError({
  reason: "version-too-old",
  detail: "card testing",
  feature: "cardTests",
  since: 66,
  tokenFeature: null,
  serverVersion: "v1.65.0",
});

function key(entity: CheckedEntity): string {
  return entityKey({ type: entity.type, entityId: entity.entity_id });
}

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
    lookUpEntities: async () => new Map([[key(DAILY), { kind: "found", id: 3 }]]),
    readEntity: async () => {},
    listTests: async () => [transformTest(9, "second"), transformTest(4, "first")],
    runTest: async () => PASSED_RUN,
    nowMs: () => 0,
    ...overrides,
  };
}

async function reportsGiven(
  checked: readonly CheckedEntity[],
  testedInBranch: ReadonlySet<string>,
  stagePort: UnitStagePort,
): Promise<CiEventBody[]> {
  const bodies: CiEventBody[] = [];
  await unitStage(checked, testedInBranch, async () => stagePort).run((check) =>
    bodies.push({ type: "check.result", stage: "unit", ...check }),
  );
  return bodies;
}

// Every checked transform has a test file in the branch, as when the coverage check passes.
function reports(
  checked: readonly CheckedEntity[],
  stagePort: UnitStagePort,
): Promise<CiEventBody[]> {
  return reportsGiven(checked, new Set(checked.map(key)), stagePort);
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
        runTest: async (_type, testId) => {
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
      port({ lookUpEntities: async () => new Map([[key(DAILY), { kind: "not-found" }]]) }),
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
        lookUpEntities: async () => new Map([[key(DAILY), { kind: "invalid-entity-id" }]]),
      }),
    );

    expect(bodies).toEqual([
      testCheck(DAILY.entity_id, "Daily", "refused", {
        error_code: "ci.invalid-entity-id",
        message: "the transform's entity_id in the branch is not a valid entity id",
      }),
    ]);
  });

  it("reports nothing for a transform with no test in the branch, which the coverage check owns", async () => {
    expect(await reportsGiven([DAILY], new Set(), port({ listTests: async () => [] }))).toEqual([]);
  });

  it("refuses a transform whose test the branch holds and the instance does not list", async () => {
    expect(await reports([DAILY], port({ listTests: async () => [] }))).toEqual([
      testCheck(DAILY.entity_id, "Daily", "refused", {
        error_code: "ci.no-tests-on-instance",
        message:
          "the branch has a test for this transform, but the Metabase instance lists none, so no test ran; load the branch into it first",
      }),
    ]);
  });

  it("runs a card's tests as card-test checks, asking the port for the card's type", async () => {
    const asked: string[] = [];
    const bodies = await reports(
      [BIG_ORDERS],
      port({
        lookUpEntities: async () => new Map([[key(BIG_ORDERS), { kind: "found", id: 7 }]]),
        readEntity: async (type, id) => {
          asked.push(`read ${type} ${id}`);
        },
        listTests: async (type, id) => {
          asked.push(`list ${type} ${id}`);
          return [transformTest(4, "keeps big orders")];
        },
        runTest: async (type, testId) => {
          asked.push(`run ${type} ${testId}`);
          return PASSED_RUN;
        },
      }),
    );

    expect(asked).toEqual(["read card 7", "list card 7", "run card 4"]);
    expect(bodies).toEqual([
      {
        type: "check.result",
        stage: "unit",
        check: { kind: "card-test", id: "4", label: "Big orders: keeps big orders" },
        verdict: "passed",
        warnings: [],
        ms: 0,
        detail: PASSED_RUN,
      },
    ]);
  });

  it("on a server without card tests, refuses the cards the branch tests, passes over the rest, and still tests transforms", async () => {
    const untested: CheckedEntity = {
      type: "card",
      entity_id: "CCCCCCCCCCCCCCCCCCCCC",
      name: "Untested",
    };
    const other: CheckedEntity = {
      type: "card",
      entity_id: "DDDDDDDDDDDDDDDDDDDDD",
      name: "Other",
    };
    const listed: string[] = [];
    const bodies: CiEventBody[] = [];
    const stage = unitStage(
      [untested, BIG_ORDERS, other, DAILY],
      new Set([key(BIG_ORDERS), key(other), key(DAILY)]),
      async () =>
        port({
          lookUpEntities: async (entities) =>
            new Map(entities.map((entity) => [key(entity), { kind: "found", id: 3 }])),
          listTests: async (type) => {
            listed.push(type);
            return type === "card" ? Promise.reject(NO_CARD_TESTS) : [transformTest(4, "first")];
          },
        }),
    );

    const stopped = await stage.run((check) =>
      bodies.push({ type: "check.result", stage: "unit", ...check }),
    );

    const unsupported = { error_code: "ci.unsupported-server", message: NO_CARD_TESTS.message };
    expect(stopped).toBeNull();
    expect(listed).toEqual(["card", "transform"]);
    expect(bodies).toEqual([
      {
        type: "check.result",
        stage: "unit",
        check: { kind: "card-test", id: BIG_ORDERS.entity_id, label: "Big orders" },
        verdict: "refused",
        warnings: [],
        ms: 0,
        detail: unsupported,
      },
      {
        type: "check.result",
        stage: "unit",
        check: { kind: "card-test", id: other.entity_id, label: "Other" },
        verdict: "refused",
        warnings: [],
        ms: 0,
        detail: unsupported,
      },
      testCheck("4", "Daily: first", "passed", PASSED_RUN),
    ]);
  });

  it("does not connect when built, only when it runs", async () => {
    let connections = 0;
    const stage = unitStage([], new Set(), async () => {
      connections += 1;
      return port({});
    });

    expect(connections).toBe(0);
    await stage.run(() => undefined);
    expect(connections).toBe(1);
  });

  it("ends without a test run, saying why, when no Metabase credential is configured", async () => {
    const stage = unitStage([DAILY], new Set(), async () => {
      throw new NotAuthenticatedError('Not authenticated for profile "default".');
    });

    expect(await stage.run(() => undefined)).toEqual({
      code: "ci.no-credential",
      message:
        'no Metabase credential, so the tests did not run: Not authenticated for profile "default".',
    });
  });

  it("rethrows any other config error from connecting", async () => {
    const stage = unitStage([DAILY], new Set(), async () => {
      throw new ConfigError("a profile bound to another URL");
    });

    await expect(stage.run(() => undefined)).rejects.toThrow(
      new ConfigError("a profile bound to another URL"),
    );
  });

  it("reports a test Metabase refuses to run, and keeps running the others", async () => {
    const refused = refusal("transform-test.unused-inputs", "Declared for a table it never reads.");
    const bodies = await reports(
      [DAILY],
      port({
        runTest: async (_type, testId) => {
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
        readEntity: async () =>
          Promise.reject(httpError(403, "Forbidden", "You don't have permissions to do that.")),
        listTests: async (_type, transformId) => {
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
        runTest: async (_type, testId) =>
          testId === 4 ? Promise.reject(SERVER_ERROR) : PASSED_RUN,
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
    const stage = unitStage([DAILY], new Set(), async () =>
      port({
        runTest: async (_type, testId) => {
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
    const stopped = await unitStage([DAILY], new Set(), async () =>
      port({ lookUpEntities: async () => Promise.reject(SERVER_ERROR) }),
    ).run(() => {
      throw new Error("no check expected");
    });

    expect(stopped).toEqual({ code: "ci.http-error", message: SERVER_ERROR.message });
  });

  it("looks every checked transform up in one request", async () => {
    const asked: string[][] = [];
    const other: CheckedEntity = {
      type: "transform",
      entity_id: "BBBBBBBBBBBBBBBBBBBBB",
      name: "Other",
    };

    await reports(
      [DAILY, other],
      port({
        lookUpEntities: async (entities) => {
          asked.push(entities.map((entity) => entity.entity_id));
          return new Map(entities.map((entity) => [key(entity), { kind: "not-found" }]));
        },
      }),
    );

    expect(asked).toEqual([[DAILY.entity_id, other.entity_id]]);
  });

  it("checks transforms in checked order, and each transform's tests in id order", async () => {
    const early: CheckedEntity = {
      type: "transform",
      entity_id: "AAAAAAAAAAAAAAAAAAAAA",
      name: "Early",
    };
    const late: CheckedEntity = {
      type: "transform",
      entity_id: "BBBBBBBBBBBBBBBBBBBBB",
      name: "Late",
    };
    const bodies = await reports(
      [late, early],
      port({
        lookUpEntities: async () =>
          new Map([
            [key(early), { kind: "found", id: 1 }],
            [key(late), { kind: "found", id: 2 }],
          ]),
        listTests: async (_type, transformId) =>
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

const CARD = {
  id: 7,
  name: "Big orders",
  type: "question",
  display: "table",
  description: null,
  archived: false,
  query_type: "query",
  database_id: 1,
  table_id: 2,
  collection_id: 3,
  entity_id: BIG_ORDERS.entity_id,
  creator_id: 1,
  dataset_query: { type: "query" },
  visualization_settings: {},
  collection_position: null,
  parameters: [],
  result_metadata: null,
};

const CARD_TEST = {
  id: 4,
  entity_id: "cardtest4xxxxxxxxxxxx",
  card_id: 7,
  creator_id: 1,
  name: "keeps big orders",
  description: null,
  inputs: [],
  expectations: [],
  created_at: "2026-10-30T12:00:00Z",
  updated_at: "2026-10-30T12:00:00Z",
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

    const lookups = await clientPort(client).lookUpEntities([
      DAILY,
      { type: "transform", entity_id: "bad", name: "Bad" },
      { type: "transform", entity_id: "XXXXXXXXXXXXXXXXXXXXX", name: "Gone" },
    ]);

    expect([...lookups]).toEqual([
      ["transform:7JwIkkAG-06-nsl4jzsaq", { kind: "found", id: 3 }],
      ["transform:bad", { kind: "invalid-entity-id" }],
      ["transform:XXXXXXXXXXXXXXXXXXXXX", { kind: "not-found" }],
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

    await clientPort(client).readEntity("transform", 3);

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

    expect(await clientPort(client).listTests("transform", 3)).toEqual([transformTest(4, "first")]);
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
    const lookUp = clientPort(client).lookUpEntities([DAILY]);

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

    await clientPort(client).runTest("transform", 4);

    expect(run.mock.calls).toEqual([[4, { timeoutMs: 120_000, signal: interruptSignal }]]);
  });

  it("arms the request timer with 120000 ms, not the transport's 30000 ms default", async () => {
    const client = createClient(CREDENTIALS, {
      userAgent: TEST_USER_AGENT,
      fetchImpl: captureFetch([jsonResponse(PASSED_RUN)]).fetch,
    });
    const timeout = vi.spyOn(AbortSignal, "timeout");

    await clientPort(client).runTest("transform", 4);

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

    await stagePort.lookUpEntities([DAILY]);
    await stagePort.listTests("transform", 3);

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

    expect(await clientPort(client).runTest("transform", 4)).toEqual(PASSED_RUN);
    expect(capture.calls.map((call) => [call.method, call.url])).toEqual([
      ["POST", "https://mb.example.com/api/ee/transform-test/4/run"],
    ]);
  });

  it("looks transforms and cards up in one request, each under its own model", async () => {
    const capture = captureFetch([
      jsonResponse({
        entity_ids: {
          [DAILY.entity_id]: { status: "ok", type: "transform", id: 3 },
          [BIG_ORDERS.entity_id]: { status: "ok", type: "card", id: 7 },
        },
      }),
    ]);
    const client = createClient(CREDENTIALS, {
      userAgent: TEST_USER_AGENT,
      fetchImpl: capture.fetch,
    });

    const lookups = await clientPort(client).lookUpEntities([DAILY, BIG_ORDERS]);

    expect([...lookups]).toEqual([
      [`transform:${DAILY.entity_id}`, { kind: "found", id: 3 }],
      [`card:${BIG_ORDERS.entity_id}`, { kind: "found", id: 7 }],
    ]);
    expect(capture.calls.map((call) => call.body)).toEqual([
      `{"entity_ids":{"transform":["${DAILY.entity_id}"],"card":["${BIG_ORDERS.entity_id}"]}}`,
    ]);
  });

  it("reads a card, lists its tests and runs one on the card routes", async () => {
    const capture = captureFetch([
      jsonResponse(CARD),
      jsonResponse([CARD_TEST]),
      jsonResponse(PASSED_RUN),
    ]);
    const client = createClient(CREDENTIALS, {
      userAgent: TEST_USER_AGENT,
      fetchImpl: capture.fetch,
    });
    const stagePort = clientPort(client);

    await stagePort.readEntity("card", 7);
    const tests = await stagePort.listTests("card", 7);
    const run = await stagePort.runTest("card", 4);

    expect([tests, run]).toEqual([[CARD_TEST], PASSED_RUN]);
    expect(capture.calls.map((call) => [call.method, call.url])).toEqual([
      ["GET", "https://mb.example.com/api/card/7"],
      ["GET", "https://mb.example.com/api/ee/card-test?card-id=7"],
      ["POST", "https://mb.example.com/api/ee/card-test/4/run"],
    ]);
  });
});
