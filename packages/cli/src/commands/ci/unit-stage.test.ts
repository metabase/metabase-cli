import { describe, expect, it, vi } from "vitest";

import { createClient } from "@metabase/client/client";
import type { DataTestRunResult, DataTestType } from "@metabase/client/domain/data-test";
import { ConfigError } from "@metabase/client/errors";
import { HttpError } from "@metabase/client/http/errors";
import type { ClientCredentials } from "@metabase/client/http/transport";
import {
  captureFetch,
  jsonResponse,
  TEST_USER_AGENT,
} from "@metabase/client/testing/fetch-capture";
import { CapabilityError } from "@metabase/client/version/capability-error";

import type {
  CheckedEntity,
  CheckKind,
  CiEventBody,
  StageSkip,
  StageStop,
} from "../../core/ci-events";
import { NotAuthenticatedError } from "../../core/config";
import { interruptSignal } from "../../runtime/interrupt";

import {
  type InstanceTest,
  type UnitScope,
  type UnitStagePort,
  clientPort,
  unitStage,
} from "./unit-stage";

const FAILED_RUN: DataTestRunResult = {
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

const PASSED_RUN: DataTestRunResult = {
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
const FORBIDDEN = httpError(403, "Forbidden", JSON.stringify({ message: "no" }));
const ROUTE_MISSING = httpError(404, "Not Found", JSON.stringify("API endpoint does not exist."));
const REFUSED = httpError(
  400,
  "Bad Request",
  JSON.stringify({ message: "no input for orders", "error-code": "card-test.missing-inputs" }),
);

const TOO_OLD_FOR_CARD_TESTS = new CapabilityError({
  reason: "version-too-old",
  detail: "no card tests",
  feature: "cardTests",
  since: 66,
  tokenFeature: "transforms-testing",
  serverVersion: "v1.65.0",
});

const UNLICENSED_FOR_CARD_TESTS = new CapabilityError({
  reason: "missing-token-feature",
  detail: "no transforms-testing",
  feature: "cardTests",
  since: 66,
  tokenFeature: "transforms-testing",
  serverVersion: "v1.66.0",
});

const TOO_OLD_FOR_DATA_TESTS = new CapabilityError({
  reason: "version-too-old",
  detail: "no data tests",
  feature: "transformTests",
  since: 65,
  tokenFeature: "transforms-testing",
  serverVersion: "v1.64.0",
});

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
  return { checked, tested: new Set(tested) };
}

const BOTH = changed([ORDERS_TRANSFORM, REVENUE_CARD]);

const FOUND = new Map([
  ["transform:AbCdEfGhIjKlMnOpQrStU", { kind: "found", id: 7 } as const],
  ["card:VwXyZaBcDeFgHiJkLmNoP", { kind: "found", id: 12 } as const],
]);

function port(overrides: Partial<UnitStagePort>): UnitStagePort {
  return {
    lookUpEntities: async () => FOUND,
    readEntity: async () => {},
    listTests: async (type) => TESTS[type],
    runTest: async () => PASSED_RUN,
    nowMs: () => 0,
    ...overrides,
  };
}

interface StageRun {
  checks: CiEventBody[];
  stopped: StageStop | StageSkip | null;
}

async function runStage(stagePort: UnitStagePort, scope: UnitScope = BOTH): Promise<StageRun> {
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
  it("runs each entity's tests, listed by its id on the instance, labelled with its name", async () => {
    const listTests = vi.fn(async (type: DataTestType) => TESTS[type]);
    const result = await runStage(port({ listTests }));

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
    const result = await runStage(port({ lookUpEntities: async () => lookups }));

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

  it("refuses an entity the branch tests when the instance lists no test for it", async () => {
    const result = await runStage(
      port({ listTests: async () => [] }),
      changed([REVENUE_CARD], [`card:${REVENUE_CARD.entity_id}`]),
    );

    expect(result.checks).toEqual([
      testCheck("card-test", REVENUE_CARD.entity_id, "revenue", "refused", {
        error_code: "ci.no-tests-on-instance",
        message:
          "the branch has a test for this entity, but the Metabase instance lists none, so no test ran; load the branch into it first",
      }),
    ]);
  });

  it("reports nothing for an entity with no tests that the branch does not test", async () => {
    const result = await runStage(port({ listTests: async () => [] }));

    expect(result).toEqual({ checks: [], stopped: null });
  });

  it("refuses an entity the CI identity cannot read, since Metabase would hide its tests", async () => {
    const result = await runStage(
      port({
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

  it.each([
    ["the server is too old for", TOO_OLD_FOR_CARD_TESTS],
    ["the server has no route for yet", ROUTE_MISSING],
  ])("reports nothing for an entity whose type %s", async (_case, error) => {
    const result = await runStage(
      port({
        listTests: async (type) => {
          if (type === "card") {
            throw error;
          }
          return TESTS[type];
        },
      }),
    );

    expect(result.checks).toEqual([
      testCheck("transform-test", "4", "orders: first", "passed", PASSED_RUN),
      testCheck("transform-test", "9", "orders: second", "passed", PASSED_RUN),
    ]);
  });

  it("refuses an entity the branch tests whose type the server cannot test, and runs the others", async () => {
    const result = await runStage(
      port({
        listTests: async (type) => {
          if (type === "card") {
            throw TOO_OLD_FOR_CARD_TESTS;
          }
          return TESTS[type];
        },
      }),
      changed([ORDERS_TRANSFORM, REVENUE_CARD], [`card:${REVENUE_CARD.entity_id}`]),
    );

    expect(result).toEqual({
      checks: [
        testCheck("transform-test", "4", "orders: first", "passed", PASSED_RUN),
        testCheck("transform-test", "9", "orders: second", "passed", PASSED_RUN),
        testCheck("card-test", REVENUE_CARD.entity_id, "revenue", "refused", {
          error_code: "ci.test-type-unsupported",
          message:
            "the branch has a test for this entity, but the Metabase instance cannot run tests of its type, so no test ran",
        }),
      ],
      stopped: null,
    });
  });

  it.each([
    ["is unlicensed", REVENUE_CARD, UNLICENSED_FOR_CARD_TESTS],
    ["has no data tests", ORDERS_TRANSFORM, TOO_OLD_FOR_DATA_TESTS],
  ])("stops when the server %s", async (_case, entity, error) => {
    const result = await runStage(
      port({
        listTests: async () => {
          throw error;
        },
      }),
      changed([entity]),
    );

    expect(result).toEqual({
      checks: [],
      stopped: { code: "ci.unsupported-server", message: error.message },
    });
  });

  it("errors a transform whose test list has no route, rather than passing it", async () => {
    const result = await runStage(
      port({
        listTests: async (type) => {
          if (type === "transform") {
            throw ROUTE_MISSING;
          }
          return TESTS[type];
        },
      }),
      changed([ORDERS_TRANSFORM]),
    );

    expect(result).toEqual({
      checks: [
        testCheck("transform-test", ORDERS_TRANSFORM.entity_id, "orders", "error", {
          error_code: "ci.http-error",
          status: 404,
          message: ROUTE_MISSING.message,
        }),
      ],
      stopped: null,
    });
  });

  it("stops when the entity-id lookup gets a rejected credential", async () => {
    const result = await runStage(
      port({
        lookUpEntities: async () => {
          throw UNAUTHORIZED;
        },
      }),
    );

    expect(result).toEqual({
      checks: [],
      stopped: { code: "ci.unauthorized", message: UNAUTHORIZED.message },
    });
  });

  it("fails a test with a failed expectation", async () => {
    const stagePort = port({ runTest: async () => FAILED_RUN });

    expect((await runStage(stagePort, changed([REVENUE_CARD]))).checks).toEqual([
      testCheck("card-test", "34", "revenue: revenue ignores refunds", "failed", FAILED_RUN),
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

    expect((await runStage(stagePort, changed([REVENUE_CARD, ORDERS_TRANSFORM]))).checks).toEqual([
      testCheck("card-test", "34", "revenue: revenue ignores refunds", "refused", {
        error_code: "card-test.missing-inputs",
        message: "no input for orders",
        tables: null,
      }),
      testCheck("transform-test", "4", "orders: first", "passed", PASSED_RUN),
      testCheck("transform-test", "9", "orders: second", "passed", PASSED_RUN),
    ]);
  });

  it("reports a run that failed with a 500 as an error check, and runs the next test", async () => {
    const stagePort = port({
      runTest: async (_type, testId) => {
        if (testId === 4) {
          throw SERVER_ERROR;
        }
        return PASSED_RUN;
      },
    });

    expect((await runStage(stagePort)).checks).toEqual([
      testCheck("transform-test", "4", "orders: first", "error", {
        error_code: "ci.http-error",
        status: 500,
        message: SERVER_ERROR.message,
      }),
      testCheck("transform-test", "9", "orders: second", "passed", PASSED_RUN),
      testCheck("card-test", "34", "revenue: revenue ignores refunds", "passed", PASSED_RUN),
    ]);
  });

  it("reports an entity whose test list failed with a 500 as an error check, and checks the next one", async () => {
    const stagePort = port({
      listTests: async (type) => {
        if (type === "transform") {
          throw SERVER_ERROR;
        }
        return TESTS[type];
      },
    });

    expect((await runStage(stagePort)).checks).toEqual([
      testCheck("transform-test", ORDERS_TRANSFORM.entity_id, "orders", "error", {
        error_code: "ci.http-error",
        status: 500,
        message: SERVER_ERROR.message,
      }),
      testCheck("card-test", "34", "revenue: revenue ignores refunds", "passed", PASSED_RUN),
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
      checks: [testCheck("transform-test", "4", "orders: first", "passed", PASSED_RUN)],
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
      runTest: async () => {
        clock += 250;
        return PASSED_RUN;
      },
      nowMs: () => clock,
    });

    expect((await runStage(stagePort, changed([REVENUE_CARD]))).checks).toEqual([
      {
        ...testCheck("card-test", "34", "revenue: revenue ignores refunds", "passed", PASSED_RUN),
        ms: 250,
      },
    ]);
  });

  it("does not connect when built, only when it runs", async () => {
    const connect = vi.fn(async () => port({}));
    const stage = unitStage(BOTH, connect);

    expect(connect).not.toHaveBeenCalled();
    await stage.run(() => {});
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it("ends without a test run, saying why, when no Metabase credential is configured", async () => {
    const missing = new NotAuthenticatedError("no credential for https://mb.example.com");
    const stopped = await unitStage(BOTH, async () => {
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
      unitStage(BOTH, async () => {
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

  it("runs a test with the 120 s per-test timeout and the interrupt signal", async () => {
    const { client } = clientOver([jsonResponse(PASSED_RUN)]);
    const run = vi.spyOn(client.dataTest, "run");

    await clientPort(client).runTest("card", 34);

    expect(run.mock.calls).toEqual([["card", 34, { timeoutMs: 120_000, signal: interruptSignal }]]);
  });
});
