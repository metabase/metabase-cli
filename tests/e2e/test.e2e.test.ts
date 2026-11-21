import { afterEach, beforeAll, describe, expect, it } from "vitest";

import type { FeatureName } from "@metabase/client/version/features";
import {
  DATA_TEST_SCHEMAS,
  type DataTest,
  type DataTestDefinition,
  type DataTestExpectationResult,
} from "@metabase/client/domain/data-test";
import {
  TestSuite,
  TestSuiteCompact,
  TestSuiteRun,
  type TestSuiteCreateInput,
  type TestSuiteMemberStatus,
  type TestSuiteRunEntry,
  type TestSuiteUpdateInput,
} from "@metabase/client/domain/test-suite";
import { parseJson } from "@metabase/client/json";

import { DeleteResult } from "../../packages/cli/src/commands/delete-runtime";
import { TestListEnvelope } from "../../packages/cli/src/commands/test/list";
import { TestSuiteListEnvelope } from "../../packages/cli/src/commands/test-suite/list";
import { TestSuiteRunListEnvelope } from "../../packages/cli/src/commands/test-suite/runs";
import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { cliErrorCategory, cliErrorMessage } from "./cli-error";
import { type RunCliResult, cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";
import { SEEDED } from "./seed/seeded";
import {
  requirementFailure,
  requireServer,
  requireServerWithout,
  DOWNGRADE_REMEDY,
} from "./server-gate";

let bootstrap: E2EBootstrap;
const tempDirs: string[] = [];

beforeAll(async () => {
  bootstrap = await readBootstrap();
});

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(cleanupConfigHome));
});

async function mb(args: string[]) {
  const configHome = await mkTempConfigHome();
  tempDirs.push(configHome);
  return runCli({
    args,
    configHome,
    env: { MB_URL: bootstrap.baseUrl, MB_API_KEY: bootstrap.adminApiKey },
  });
}

// The refusal a server without `feature` answers with, as the client explains it.
function liveRefusal(feature: FeatureName): string {
  const gap = requirementFailure([feature]);
  if (gap === null) {
    throw new Error(`this lane runs only on a server without ${feature}`);
  }
  return gap.reason === "version-too-old" ? `${gap.detail}\n${DOWNGRADE_REMEDY}` : gap.detail;
}

describe("test e2e, refs", () => {
  it("refuses a test ref where the entity under test belongs, before reaching the server", async () => {
    const result = await mb(["test", "create", "--id", "card-test:12", "--body", "{}"]);

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toBe(
      'invalid --id: "card-test:12" names a test; this command takes the entity under test, <type>:<id>, such as card:12',
    );
  });

  it("refuses a type no test covers", async () => {
    const result = await mb(["test", "get", "--id", "dashboard-test:7"]);

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toBe(
      'invalid --id: "dashboard-test:7" (expected <type>-test:<id>, such as card-test:34, where <type> is one of: transform, card, segment, measure, action)',
    );
  });

  it("refuses an --id and --type that name different types", async () => {
    const result = await mb(["test", "list", "--id", "card:12", "--type", "segment"]);

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toBe(
      "--id card:12 is not of type segment; drop --type or --id",
    );
  });
});

const noCardTestsSkipReason = requireServerWithout("test › server without card tests", [
  "cardTests",
]);

describe.skipIf(noCardTestsSkipReason !== null)("test e2e on a server without card tests", () => {
  it("explains a card test the server cannot hold with its own answer and exits 2", async () => {
    const result = await mb(["test", "get", "--id", "card-test:1", "--json"]);

    expect(result.exitCode).toBe(2);
    expect(cliErrorCategory(result.stderr)).toBe("capability");
    expect(cliErrorMessage(result.stderr)).toBe(liveRefusal("cardTests"));
  });

  it("explains a card test run the same way", async () => {
    const result = await mb(["test", "run", "--id", "card-test:1", "--json"]);

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toBe(liveRefusal("cardTests"));
  });

  it("explains a listing narrowed to card tests the same way", async () => {
    const result = await mb(["test", "list", "--type", "card", "--json"]);

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toBe(liveRefusal("cardTests"));
  });
});

const onlyTransformTestsLane = "test › server with only transform tests";
const onlyTransformTestsSkipReason =
  requireServer(onlyTransformTestsLane, ["transformTests"]) ??
  requireServerWithout(onlyTransformTestsLane, [
    "cardTests",
    "segmentTests",
    "measureTests",
    "actionTests",
  ]);

describe.skipIf(onlyTransformTestsSkipReason !== null)(
  "test e2e on a server with only transform tests",
  () => {
    it("lists every test the instance holds, which on a fresh instance is none", async () => {
      const result = await mb(["test", "list", "--json"]);

      expect(result.exitCode, result.stderr).toBe(0);
      expect(parseJson(result.stdout, TestListEnvelope)).toEqual({
        data: [],
        returned: 0,
        offset: 0,
        total: 0,
        has_more: false,
        next_offset: null,
      });
    });
  },
);

const noTransformTestsSkipReason = requireServerWithout("test › server without transform tests", [
  "transformTests",
]);

describe.skipIf(noTransformTestsSkipReason !== null)(
  "test e2e on a server without transform tests",
  () => {
    it("explains a listing of every type with the server's own answer, since it can test nothing", async () => {
      const result = await mb(["test", "list", "--json"]);

      expect(result.exitCode).toBe(2);
      expect(cliErrorCategory(result.stderr)).toBe("capability");
      expect(cliErrorMessage(result.stderr)).toBe(liveRefusal("transformTests"));
    });
  },
);

const noTestSuitesSkipReason = requireServerWithout("test-suite › server without test suites", [
  "testSuites",
]);

describe.skipIf(noTestSuitesSkipReason !== null)(
  "test-suite e2e on a server without test suites",
  () => {
    it("explains the listing with the server's own answer and exits 2", async () => {
      const result = await mb(["test-suite", "list", "--json"]);

      expect(result.exitCode).toBe(2);
      expect(cliErrorCategory(result.stderr)).toBe("capability");
      expect(cliErrorMessage(result.stderr)).toBe(liveRefusal("testSuites"));
    });

    it("explains a suite run the same way", async () => {
      const result = await mb(["test-suite", "run", "--id", "1"]);

      expect(result.exitCode).toBe(2);
      expect(cliErrorMessage(result.stderr)).toBe(liveRefusal("testSuites"));
    });
  },
);

const testSuitesSkipReason = requireServer("test-suite › server with test suites", [
  "testSuites",
  "cardTests",
]);

type CardTest = DataTest<"card">;
type Verdict = Extract<TestSuiteMemberStatus, "passed" | "failed">;
type RowDifferences = Pick<
  Extract<DataTestExpectationResult, { "extra-rows": unknown }>,
  "extra-rows" | "missing-rows" | "cell-mismatches"
>;

const PAID_ORDERS = 2;

// A test of the seeded orders-by-status card over two paid orders, expecting `paidCount` of them:
// it passes only when `paidCount` is the two the stand-in orders table holds.
async function createCardTest(name: string, paidCount: number): Promise<CardTest> {
  const body: DataTestDefinition<"card"> = {
    name,
    inputs: [
      {
        table: { schema: "public", name: "orders" },
        format: "rows",
        columns: [{ name: "status", cast_type: "TEXT" }],
        rows: Array.from({ length: PAID_ORDERS }, () => ({ status: "paid" })),
      },
    ],
    expectations: [
      {
        type: "equals",
        name: "paid orders",
        format: "rows",
        columns: [
          { name: "status", cast_type: "TEXT" },
          { name: "n", cast_type: "BIGINT" },
        ],
        rows: [{ status: "paid", n: paidCount }],
      },
    ],
  };
  const result = await mb([
    "test",
    "create",
    "--id",
    `card:${SEEDED.ordersCardId}`,
    "--body",
    JSON.stringify(body),
    "--json",
    "--full",
  ]);
  expect(result.exitCode, result.stderr).toBe(0);
  return parseJson(result.stdout, DATA_TEST_SCHEMAS.card);
}

async function createSuite(body: TestSuiteCreateInput): Promise<TestSuiteCompact> {
  const result = await mb(["test-suite", "create", "--body", JSON.stringify(body), "--json"]);
  expect(result.exitCode, result.stderr).toBe(0);
  return parseJson(result.stdout, TestSuiteCompact);
}

async function updateSuite(id: number, body: TestSuiteUpdateInput): Promise<RunCliResult> {
  return mb(["test-suite", "update", "--id", String(id), "--body", JSON.stringify(body), "--json"]);
}

function memberRef(test: CardTest, position: number): object {
  return { test_type: "card", test_entity_id: test.entity_id, position };
}

function readableMember(test: CardTest, position: number): object {
  return { ...memberRef(test, position), status: "readable", test_id: test.id, name: test.name };
}

interface PaidOrdersFindings {
  status: Verdict;
  rows: RowDifferences;
}

function memberOutcome(test: CardTest, position: number, findings: PaidOrdersFindings): object {
  return {
    ...memberRef(test, position),
    status: findings.status,
    data_test_run_id: expect.any(Number),
    test_id: test.id,
    name: test.name,
    result: {
      status: findings.status,
      expectations: [
        {
          name: "paid orders",
          type: "equals",
          status: findings.status,
          columns: [
            { name: "status", database_type: "text" },
            { name: "n", database_type: "int8" },
          ],
          "row-counts": { actual: 1, expected: 1 },
          ...findings.rows,
          truncated: 0,
        },
      ],
      tables: expect.any(Object),
    },
  };
}

const PASSED: PaidOrdersFindings = {
  status: "passed",
  rows: { "extra-rows": [], "missing-rows": [], "cell-mismatches": [] },
};

const MISCOUNTED: PaidOrdersFindings = {
  status: "failed",
  rows: {
    "extra-rows": [{ status: "paid", n: PAID_ORDERS }],
    "missing-rows": [{ status: "paid", n: PAID_ORDERS + 1 }],
    "cell-mismatches": [{ column: "n", expected: PAID_ORDERS + 1, actual: PAID_ORDERS }],
  },
};

// The temp tables carry generated names, so only the tables they stood in for are pinned.
function stoodInFor(member: TestSuiteRunEntry): string[] {
  if (member.result === undefined) {
    throw new Error(`member ${member.test_entity_id} has no result`);
  }
  return Object.values(member.result.tables);
}

function runRecord(id: number, status: Verdict, initiatedBy: number): object {
  return {
    id,
    status,
    start_time: expect.any(String),
    end_time: expect.any(String),
    initiated_by: initiatedBy,
  };
}

describe.skipIf(testSuitesSkipReason !== null)(
  "test-suite e2e on a server with test suites",
  () => {
    it("creates a suite of card tests, reads it with get and list, and replaces its members with update", async () => {
      const [first, second] = await Promise.all([
        createCardTest("two paid", PAID_ORDERS),
        createCardTest("still two paid", PAID_ORDERS),
      ]);

      const created = await createSuite({
        name: "nightly",
        description: "orders checks",
        members: [{ test_type: "card", test_id: first.id }],
      });
      expect(created).toEqual({
        id: expect.any(Number),
        name: "nightly",
        description: "orders checks",
        members: [readableMember(first, 0)],
      });

      const got = await mb(["test-suite", "get", "--id", String(created.id), "--full", "--json"]);
      expect(got.exitCode, got.stderr).toBe(0);
      expect(parseJson(got.stdout, TestSuite)).toEqual({
        id: created.id,
        entity_id: expect.any(String),
        name: "nightly",
        description: "orders checks",
        creator_id: first.creator_id,
        members: [readableMember(first, 0)],
        created_at: expect.any(String),
        updated_at: expect.any(String),
      });

      const updated = await updateSuite(created.id, {
        name: "hourly",
        members: [
          { test_type: "card", test_entity_id: second.entity_id },
          { test_type: "card", test_id: first.id },
        ],
      });
      expect(updated.exitCode, updated.stderr).toBe(0);
      expect(parseJson(updated.stdout, TestSuiteCompact)).toEqual({
        id: created.id,
        name: "hourly",
        description: "orders checks",
        members: [readableMember(second, 0), readableMember(first, 1)],
      });

      const listed = await mb(["test-suite", "list", "--json"]);
      expect(listed.exitCode, listed.stderr).toBe(0);
      expect(parseJson(listed.stdout, TestSuiteListEnvelope)).toEqual({
        data: [
          {
            id: created.id,
            name: "hourly",
            description: "orders checks",
            members: [readableMember(second, 0), readableMember(first, 1)],
          },
        ],
        returned: 1,
        offset: 0,
        total: 1,
        has_more: false,
        next_offset: null,
      });
    });

    it("runs a suite with a failing member, exiting 1 with each member's result, and lists its runs newest first", async () => {
      const [passing, failing] = await Promise.all([
        createCardTest("two paid", PAID_ORDERS),
        createCardTest("three paid", PAID_ORDERS + 1),
      ]);
      const suite = await createSuite({
        name: "orders",
        members: [
          { test_type: "card", test_id: passing.id },
          { test_type: "card", test_id: failing.id },
        ],
      });

      const failed = await mb(["test-suite", "run", "--id", String(suite.id), "--json"]);

      expect(failed.exitCode).toBe(1);
      expect(cliErrorCategory(failed.stderr)).toBe("failed");
      expect(cliErrorMessage(failed.stderr)).toBe(`test suite ${suite.id} failed`);
      const failedRun = parseJson(failed.stdout, TestSuiteRun);
      expect(failedRun).toEqual({
        id: expect.any(Number),
        suite_id: suite.id,
        status: "failed",
        members: [memberOutcome(passing, 0, PASSED), memberOutcome(failing, 1, MISCOUNTED)],
      });
      expect(failedRun.members.map(stoodInFor)).toEqual([["public.orders"], ["public.orders"]]);

      const trimmed = await updateSuite(suite.id, {
        members: [{ test_type: "card", test_id: passing.id }],
      });
      expect(trimmed.exitCode, trimmed.stderr).toBe(0);

      const passed = await mb(["test-suite", "run", "--id", String(suite.id), "--json"]);

      expect(passed.exitCode, passed.stderr).toBe(0);
      const passedRun = parseJson(passed.stdout, TestSuiteRun);
      expect(passedRun).toEqual({
        id: expect.any(Number),
        suite_id: suite.id,
        status: "passed",
        members: [memberOutcome(passing, 0, PASSED)],
      });

      const runs = await mb(["test-suite", "runs", "--id", String(suite.id), "--json"]);

      expect(runs.exitCode, runs.stderr).toBe(0);
      expect(parseJson(runs.stdout, TestSuiteRunListEnvelope)).toEqual({
        data: [
          runRecord(passedRun.id, "passed", passing.creator_id),
          runRecord(failedRun.id, "failed", passing.creator_id),
        ],
        returned: 2,
        offset: 0,
        total: 2,
        has_more: false,
        next_offset: null,
      });
    });

    it("deletes a suite and keeps the tests in it", async () => {
      const test = await createCardTest("two paid", PAID_ORDERS);
      const suite = await createSuite({
        name: "doomed",
        members: [{ test_type: "card", test_id: test.id }],
      });

      const deleted = await mb([
        "test-suite",
        "delete",
        "--id",
        String(suite.id),
        "--yes",
        "--json",
      ]);

      expect(deleted.exitCode, deleted.stderr).toBe(0);
      expect(parseJson(deleted.stdout, DeleteResult)).toEqual({
        id: suite.id,
        deleted: true,
        aborted: false,
      });
      const gone = await mb(["test-suite", "get", "--id", String(suite.id), "--json"]);
      expect(gone.exitCode).toBe(1);
      expect(cliErrorMessage(gone.stderr)).toContain(
        `Not found: GET /api/ee/test-suite/${suite.id}.`,
      );
      const kept = await mb(["test", "get", "--id", `card-test:${test.id}`, "--json", "--full"]);
      expect(kept.exitCode, kept.stderr).toBe(0);
      expect(parseJson(kept.stdout, DATA_TEST_SCHEMAS.card)).toEqual(test);
    });
  },
);
