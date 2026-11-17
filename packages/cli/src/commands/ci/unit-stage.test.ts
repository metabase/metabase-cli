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

import type { CheckedEntity, CheckKind, CiEventBody, StageStop } from "../../core/ci-events";
import { NotAuthenticatedError } from "../../core/config";
import { interruptSignal } from "../../runtime/interrupt";

import {
  type InstanceTest,
  type UnitScope,
  type UnitStagePort,
  clientPort,
  unitStage,
} from "./unit-stage";

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

const EVERY: UnitScope = { kind: "every" };

function port(overrides: Partial<UnitStagePort>): UnitStagePort {
  return {
    lookUpEntities: async () => new Map(),
    readEntity: async () => {},
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

async function runStage(stagePort: UnitStagePort, scope: UnitScope = EVERY): Promise<StageRun> {
  const checks: CiEventBody[] = [];
  const stopped = await unitStage(scope, async () => stagePort).run((check) =>
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
    const stage = unitStage(EVERY, connect);

    expect(connect).not.toHaveBeenCalled();
    await stage.run(() => {});
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it("ends without a test run, saying why, when no Metabase credential is configured", async () => {
    const missing = new NotAuthenticatedError("no credential for https://mb.example.com");
    const stopped = await unitStage(EVERY, async () => {
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
      unitStage(EVERY, async () => {
        throw config;
      }).run(() => {}),
    ).rejects.toBe(config);
  });
});

const ORDERS_TRANSFORM: CheckedEntity = {
  type: "transform",
  entity_id: "AbCdEfGhIjKlMnOpQrStU",
  name: "orders",
};
const REVENUE_CARD: CheckedEntity = {
  type: "card",
  entity_id: "VwXyZaBcDeFgHiJkLmNoP",
  name: "revenue",
};

function changed(checked: CheckedEntity[], tested: string[] = []): UnitScope {
  return { kind: "changed", checked, tested: new Set(tested) };
}

const FOUND = new Map([
  ["transform:AbCdEfGhIjKlMnOpQrStU", { kind: "found", id: 7 } as const],
  ["card:VwXyZaBcDeFgHiJkLmNoP", { kind: "found", id: 12 } as const],
]);

const FORBIDDEN = httpError(403, "Forbidden", JSON.stringify({ message: "no" }));

describe("unitStage over the entities a change touched", () => {
  it("runs each entity's tests, listed by its id on the instance, labelled with its name", async () => {
    const listTests = vi.fn(async (type: DataTestType) => TESTS[type]);
    const result = await runStage(
      port({ lookUpEntities: async () => FOUND, listTests }),
      changed([ORDERS_TRANSFORM, REVENUE_CARD]),
    );

    expect(listTests.mock.calls).toEqual([
      ["transform", 7],
      ["card", 12],
    ]);
    expect(result).toEqual({
      checks: [
        testCheck("transform-test", "4", "orders: first", "passed", PASSED_RUN),
        testCheck("transform-test", "9", "orders: second", "passed", PASSED_RUN),
        testCheck("card-test", "34", "revenue: revenue ignores refunds", "passed", PASSED_RUN),
      ],
      stopped: null,
    });
  });

  it("refuses an entity the instance does not hold, and one whose entity id is invalid", async () => {
    const lookups = new Map([
      ["transform:AbCdEfGhIjKlMnOpQrStU", { kind: "not-found" } as const],
      ["card:VwXyZaBcDeFgHiJkLmNoP", { kind: "invalid-entity-id" } as const],
    ]);
    const result = await runStage(
      port({ lookUpEntities: async () => lookups }),
      changed([ORDERS_TRANSFORM, REVENUE_CARD]),
    );

    expect(result.checks).toEqual([
      testCheck("transform-test", ORDERS_TRANSFORM.entity_id, "orders", "refused", {
        error_code: "ci.entity-not-on-instance",
        message:
          "the entity is in the branch but not on the Metabase instance; load the branch into it first",
      }),
      testCheck("card-test", REVENUE_CARD.entity_id, "revenue", "refused", {
        error_code: "ci.invalid-entity-id",
        message: "the entity's entity_id in the branch is not a valid entity id",
      }),
    ]);
  });

  it("refuses a transform the branch tests when the instance lists no test for it", async () => {
    const result = await runStage(
      port({ lookUpEntities: async () => FOUND, listTests: async () => [] }),
      changed([ORDERS_TRANSFORM], [ORDERS_TRANSFORM.entity_id]),
    );

    expect(result.checks).toEqual([
      testCheck("transform-test", ORDERS_TRANSFORM.entity_id, "orders", "refused", {
        error_code: "ci.no-tests-on-instance",
        message:
          "the branch has a test for this transform, but the Metabase instance lists none, so no test ran; load the branch into it first",
      }),
    ]);
  });

  it("reports nothing for an entity with no tests that the branch does not test", async () => {
    const result = await runStage(
      port({ lookUpEntities: async () => FOUND, listTests: async () => [] }),
      changed([ORDERS_TRANSFORM, REVENUE_CARD]),
    );

    expect(result).toEqual({ checks: [], stopped: null });
  });

  it("refuses an entity the CI identity cannot read, since Metabase would hide its tests", async () => {
    const result = await runStage(
      port({
        lookUpEntities: async () => FOUND,
        readEntity: async () => {
          throw FORBIDDEN;
        },
      }),
      changed([REVENUE_CARD]),
    );

    expect(result.checks).toEqual([
      testCheck("card-test", REVENUE_CARD.entity_id, "revenue", "refused", {
        error_code: "ci.entity-unreadable",
        message:
          "the CI identity cannot read this entity, so Metabase hides its tests: reading it needs query permission on every table it reads",
      }),
    ]);
  });

  it("reports nothing for an entity whose type the server cannot test", async () => {
    const result = await runStage(
      port({
        lookUpEntities: async () => FOUND,
        listTests: async (type) => {
          if (type === "card") {
            throw unsupported(type);
          }
          return TESTS[type];
        },
      }),
      changed([REVENUE_CARD, ORDERS_TRANSFORM]),
    );

    expect(result.checks).toEqual([
      testCheck("transform-test", "4", "orders: first", "passed", PASSED_RUN),
      testCheck("transform-test", "9", "orders: second", "passed", PASSED_RUN),
    ]);
  });

  it("stops when the server cannot test a transform the branch tests", async () => {
    const result = await runStage(
      port({
        lookUpEntities: async () => FOUND,
        listTests: async (type) => {
          throw unsupported(type);
        },
      }),
      changed([ORDERS_TRANSFORM], [ORDERS_TRANSFORM.entity_id]),
    );

    expect(result).toEqual({
      checks: [],
      stopped: { code: "ci.unsupported-server", message: unsupported("transform").message },
    });
  });

  it("stops when the entity-id lookup gets a rejected credential", async () => {
    const result = await runStage(
      port({
        lookUpEntities: async () => {
          throw UNAUTHORIZED;
        },
      }),
      changed([ORDERS_TRANSFORM]),
    );

    expect(result).toEqual({
      checks: [],
      stopped: { code: "ci.unauthorized", message: UNAUTHORIZED.message },
    });
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

    await clientPort(client).listTests("transform", null);

    expect(capture.calls.map((call) => [call.method, call.url])).toEqual([
      ["GET", "https://mb.example.com/api/ee/transform-test"],
    ]);
  });

  it("lists the tests of one entity by its id", async () => {
    const { client, capture } = clientOver([jsonResponse([])]);

    await clientPort(client).listTests("card", 12);

    expect(capture.calls.map((call) => [call.method, call.url])).toEqual([
      ["GET", "https://mb.example.com/api/ee/card-test?card-id=12"],
    ]);
  });

  it("looks up every entity's id in one request, grouped by model", async () => {
    const { client } = clientOver([
      jsonResponse({
        entity_ids: {
          [ORDERS_TRANSFORM.entity_id]: { status: "ok", type: "transform", id: 7 },
          [REVENUE_CARD.entity_id]: { status: "not-found", type: "card" },
        },
      }),
    ]);
    const translate = vi.spyOn(client.eidTranslation, "translate");

    const lookups = await clientPort(client).lookUpEntities([ORDERS_TRANSFORM, REVENUE_CARD]);

    expect(translate.mock.calls).toEqual([
      [
        {
          entity_ids: {
            transform: [ORDERS_TRANSFORM.entity_id],
            card: [REVENUE_CARD.entity_id],
          },
        },
        { signal: interruptSignal },
      ],
    ]);
    expect(lookups).toEqual(
      new Map([
        ["transform:AbCdEfGhIjKlMnOpQrStU", { kind: "found", id: 7 }],
        ["card:VwXyZaBcDeFgHiJkLmNoP", { kind: "not-found" }],
      ]),
    );
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
