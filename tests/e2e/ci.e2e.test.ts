import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { DataTestRunResult } from "@metabase/client/domain/data-test";
import { parseJson } from "@metabase/client/json";

import { CiEvent } from "../../packages/cli/src/core/ci-events";
import { type TempGitRepo, createTempGitRepo } from "../../packages/cli/src/runtime/temp-git-repo";
import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { cliErrorCategory, cliErrorMessage } from "./cli-error";
import { type RunCliResult, cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";
import { SEEDED } from "./seed/seeded";
import { requirementFailure, requireServer } from "./server-gate";

const TRANSFORM_ID = "7JwIkkAG-06-nsl4jzsaq";
const ANY_ENVELOPE = { job: expect.any(String), at: expect.any(String) };

const lintGap = requirementFailure(["lintReport"]);
const SAVED_QUERY_CHECKS = lintGap === null ? 1 : 0;

function sequenced(bodies: readonly object[], firstSeq: number): unknown[] {
  return bodies.map((body, index) => ({ ...ANY_ENVELOPE, ...body, seq: firstSeq + index }));
}

// The lint stage on this stack: a clean check of the instance's entities, or, on a stack
// without the lint report, a skip that leaves the stage passed.
function lintStage(): object[] {
  const start = { type: "stage.start", stage: "lint" };
  if (lintGap === null) {
    return [
      start,
      {
        type: "check.result",
        stage: "lint",
        check: { kind: "broken-refs", id: "instance", label: "Entities on the instance" },
        verdict: "passed",
        warnings: [],
        ms: expect.any(Number),
        detail: { errors: 0, warnings: 0, entities: 0 },
      },
      { type: "stage.end", stage: "lint", status: "passed", stopped: null, skipped: null },
    ];
  }
  return [
    start,
    {
      type: "stage.end",
      stage: "lint",
      status: "passed",
      stopped: null,
      skipped: { code: "ci.lint-unsupported", message: lintGap.detail },
    },
  ];
}

function testYaml(transformEntityId: string): string {
  return `entity_id: aRvM7DLesF1fOV4kRHidq\ntransform_id: ${transformEntityId}\nexpectations:\n- name: e\n  type: empty\nserdes/meta:\n- model: TransformTest\n`;
}

describe("ci e2e", () => {
  const tempDirs: string[] = [];
  let repo: TempGitRepo;

  beforeEach(async () => {
    repo = await createTempGitRepo();
  });

  afterEach(async () => {
    await repo.remove();
    await Promise.all(tempDirs.splice(0).map(cleanupConfigHome));
  });

  async function configHome(): Promise<string> {
    const dir = await mkTempConfigHome();
    tempDirs.push(dir);
    return dir;
  }

  it("streams one event per line, and writes them to --results, running only the lint stage for a job with nothing to check", async () => {
    const base = await repo.git("rev-parse", "HEAD");
    await repo.put(
      "transforms/draft.yaml",
      `name: Draft\nentity_id: ${TRANSFORM_ID}\nsource:\n  type: query\ntarget:\n  name: t\nserdes/meta:\n- model: Transform\n`,
    );
    const resultsPath = join(repo.path, "results.json");

    const result = await runCli({
      args: ["ci", "run", "--repo", repo.path, "--base", "main", "--results", resultsPath],
      configHome: await configHome(),
    });

    expect(result.exitCode, result.stderr).toBe(1);
    const events = result.stdout
      .trimEnd()
      .split("\n")
      .map((line) => parseJson(line, CiEvent));
    expect(events).toEqual([
      {
        ...ANY_ENVELOPE,
        seq: 0,
        type: "job.start",
        v: 2,
        snapshot: { base, head: base },
        checked: [],
        warnings: [
          {
            code: "no-content-changes",
            message: "the change touches no Metabase content files",
          },
          {
            code: "uncommitted-content",
            message:
              "1 content file has uncommitted changes, which CI does not see; it checks the committed version: transforms/draft.yaml",
          },
        ],
      },
      { ...ANY_ENVELOPE, seq: 1, type: "stage.start", stage: "lint" },
      {
        ...ANY_ENVELOPE,
        seq: 2,
        type: "stage.end",
        stage: "lint",
        status: "errored",
        stopped: {
          code: "ci.no-credential",
          message: expect.stringContaining(
            "no Metabase credential, so the lint report was not read",
          ),
        },
        skipped: null,
      },
      {
        ...ANY_ENVELOPE,
        seq: 3,
        type: "job.end",
        state: "errored",
        counts: { checks: 0, warnings: 2 },
      },
    ]);
    expect(parseJson(await readFile(resultsPath, "utf8"), z.array(CiEvent))).toEqual(events);
  });

  it("exits 2 with a config error when --base is not a commit", async () => {
    const result = await runCli({
      args: ["ci", "run", "--repo", repo.path, "--base", "no-such-branch"],
      configHome: await configHome(),
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorCategory(result.stderr)).toBe("config");
    const root = await repo.git("rev-parse", "--show-toplevel");
    expect(cliErrorMessage(result.stderr)).toBe(`--base no-such-branch is not a commit in ${root}`);
  });
});

const unitSkipReason = requireServer("ci › unit stage", ["transforms", "transformTests"]);

const Created = z.object({ id: z.number().int() });
const WithEntityId = z.object({ entity_id: z.string() });

type CheckResultEvent = Extract<CiEvent, { type: "check.result" }>;

interface ExpectedRows {
  "extra-rows": unknown[];
  "missing-rows": unknown[];
  "cell-mismatches": unknown[];
}

function totalsBody(operator: "+" | "-"): unknown {
  return {
    name: "Order totals",
    source: {
      type: "query",
      query: {
        type: "native",
        database: SEEDED.warehouseDbId,
        native: {
          query: `SELECT id, subtotal_cents ${operator} tax_cents AS total_cents FROM orders`,
        },
      },
    },
    target: {
      type: "table",
      database: SEEDED.warehouseDbId,
      schema: "public",
      name: "ci_order_totals",
    },
  };
}

describe.skipIf(unitSkipReason !== null)("ci e2e › unit stage", () => {
  const tempDirs: string[] = [];
  let repo: TempGitRepo;
  let bootstrap: E2EBootstrap;

  beforeAll(async () => {
    bootstrap = await readBootstrap();
  });

  beforeEach(async () => {
    repo = await createTempGitRepo();
  });

  afterEach(async () => {
    await repo.remove();
    await Promise.all(tempDirs.splice(0).map(cleanupConfigHome));
  });

  async function mb(args: string[], stdin?: string): Promise<RunCliResult> {
    const dir = await mkTempConfigHome();
    tempDirs.push(dir);
    return runCli({
      args,
      configHome: dir,
      env: { MB_URL: bootstrap.baseUrl, MB_API_KEY: bootstrap.adminApiKey },
      ...(stdin === undefined ? {} : { stdin }),
    });
  }

  it("refuses a changed transform the instance does not hold", async () => {
    await repo.git("checkout", "-q", "-b", "feature");
    await repo.put(
      "transforms/absent.yaml",
      `name: Absent\nentity_id: ${TRANSFORM_ID}\nsource:\n  type: query\ntarget:\n  name: t\nserdes/meta:\n- model: Transform\n`,
    );
    await repo.put("transforms/absent/test.yaml", testYaml(TRANSFORM_ID));
    await repo.commitAll("add a transform the instance never saw, with a test");

    const result = await mb(["ci", "run", "--repo", repo.path, "--base", "main"]);

    expect(result.exitCode).toBe(1);
    const events = result.stdout
      .trimEnd()
      .split("\n")
      .map((line) => parseJson(line, CiEvent));
    const expected = [
      ...lintStage(),
      { type: "stage.start", stage: "unit" },
      {
        type: "check.result",
        stage: "unit",
        check: { kind: "transform-test", id: TRANSFORM_ID, label: "Absent" },
        verdict: "refused",
        warnings: [],
        ms: 0,
        detail: {
          error_code: "ci.entity-not-on-instance",
          message:
            "the entity is in the branch but not on the Metabase instance; load the branch into it first",
        },
      },
      { type: "stage.end", stage: "unit", status: "errored", stopped: null, skipped: null },
      {
        type: "job.end",
        state: "errored",
        counts: { checks: SAVED_QUERY_CHECKS + 1, warnings: 0 },
      },
    ];
    expect(events.slice(1)).toEqual(sequenced(expected, 1));
  });

  it("fails on a transform whose test catches its bug, passing the mismatch through, and passes once it is fixed", async () => {
    const created = await mb(["transform", "create", "--json"], JSON.stringify(totalsBody("-")));
    expect(created.exitCode, created.stderr).toBe(0);
    const transformId = parseJson(created.stdout, Created).id;
    const full = await mb(["transform", "get", String(transformId), "--full", "--json"]);
    const entityId = parseJson(full.stdout, WithEntityId).entity_id;
    const test = await mb(
      ["transform-test", "create", "--json"],
      JSON.stringify({
        transform_id: transformId,
        name: "total adds tax",
        inputs: [
          {
            table: { schema: "public", name: "orders" },
            format: "rows",
            columns: [
              { name: "id", cast_type: "INTEGER" },
              { name: "subtotal_cents", cast_type: "BIGINT" },
              { name: "tax_cents", cast_type: "BIGINT" },
            ],
            rows: [{ id: 1, subtotal_cents: 100, tax_cents: 10 }],
          },
        ],
        expectations: [
          {
            type: "equals",
            name: "total is subtotal plus tax",
            format: "rows",
            columns: [
              { name: "id", cast_type: "INTEGER" },
              { name: "total_cents", cast_type: "BIGINT" },
            ],
            rows: [{ id: 1, total_cents: 110 }],
          },
        ],
      }),
    );
    expect(test.exitCode, test.stderr).toBe(0);
    const testId = String(parseJson(test.stdout, Created).id);
    const base = await repo.git("rev-parse", "HEAD");
    await repo.git("checkout", "-q", "-b", "feature");
    await repo.put(
      "transforms/order_totals.yaml",
      `name: Order totals\nentity_id: ${entityId}\nsource:\n  type: query\ntarget:\n  name: t\nserdes/meta:\n- model: Transform\n`,
    );
    await repo.put("transforms/order_totals/total_adds_tax.yaml", testYaml(entityId));
    const head = await repo.commitAll("add transform and its test");

    function expectedEvents(verdict: "passed" | "failed", rows: ExpectedRows): unknown[] {
      const bodies = [
        {
          type: "job.start",
          v: 2,
          snapshot: { base, head },
          checked: [{ type: "transform", entity_id: entityId, name: "Order totals" }],
          warnings: [],
        },
        ...lintStage(),
        { type: "stage.start", stage: "unit" },
        {
          type: "check.result",
          stage: "unit",
          check: { kind: "transform-test", id: testId, label: "Order totals: total adds tax" },
          verdict,
          warnings: [],
          ms: expect.any(Number),
          detail: {
            status: verdict,
            expectations: [
              {
                name: "total is subtotal plus tax",
                type: "equals",
                status: verdict,
                columns: [
                  { name: "id", database_type: "int4" },
                  { name: "total_cents", database_type: "int8" },
                ],
                "row-counts": { actual: 1, expected: 1 },
                ...rows,
                truncated: 0,
              },
            ],
            tables: expect.any(Object),
          },
        },
        {
          type: "stage.end",
          stage: "unit",
          status: verdict,
          stopped: null,
          skipped: null,
        },
        {
          type: "job.end",
          state: verdict,
          counts: { checks: 1 + SAVED_QUERY_CHECKS, warnings: 0 },
        },
      ];
      return sequenced(bodies, 0);
    }

    function eventsOf(stdout: string): CiEvent[] {
      return stdout
        .trimEnd()
        .split("\n")
        .map((line) => parseJson(line, CiEvent));
    }

    function stoodInFor(events: CiEvent[]): string[] {
      const check = events.find(
        (event): event is CheckResultEvent =>
          event.type === "check.result" && event.stage === "unit",
      );
      if (check === undefined) {
        throw new Error("no unit check.result event");
      }
      return Object.values(DataTestRunResult.parse(check.detail).tables).toSorted();
    }

    const broken = await mb(["ci", "run", "--repo", repo.path, "--base", "main"]);

    expect(broken.exitCode).toBe(1);
    expect(eventsOf(broken.stdout)).toEqual(
      expectedEvents("failed", {
        "extra-rows": [{ id: 1, total_cents: 90 }],
        "missing-rows": [{ id: 1, total_cents: 110 }],
        "cell-mismatches": [{ column: "total_cents", expected: 110, actual: 90 }],
      }),
    );
    expect(stoodInFor(eventsOf(broken.stdout))).toEqual([
      "public.ci_order_totals",
      "public.orders",
    ]);

    const fixed = await mb(
      ["transform", "update", String(transformId), "--json"],
      JSON.stringify(totalsBody("+")),
    );
    expect(fixed.exitCode, fixed.stderr).toBe(0);
    const passing = await mb(["ci", "run", "--repo", repo.path, "--base", "main"]);

    expect(passing.exitCode, passing.stderr).toBe(0);
    expect(eventsOf(passing.stdout)).toEqual(
      expectedEvents("passed", { "extra-rows": [], "missing-rows": [], "cell-mismatches": [] }),
    );
  });
});

const cardUnitSkipReason = requireServer("ci › unit stage › card tests", ["cardTests"]);

describe.skipIf(cardUnitSkipReason !== null)("ci e2e › unit stage › card tests", () => {
  const tempDirs: string[] = [];
  let repo: TempGitRepo;
  let bootstrap: E2EBootstrap;

  beforeAll(async () => {
    bootstrap = await readBootstrap();
  });

  beforeEach(async () => {
    repo = await createTempGitRepo();
  });

  afterEach(async () => {
    await repo.remove();
    await Promise.all(tempDirs.splice(0).map(cleanupConfigHome));
  });

  async function mb(args: string[], stdin?: string): Promise<RunCliResult> {
    const dir = await mkTempConfigHome();
    tempDirs.push(dir);
    return runCli({
      args,
      configHome: dir,
      env: { MB_URL: bootstrap.baseUrl, MB_API_KEY: bootstrap.adminApiKey },
      ...(stdin === undefined ? {} : { stdin }),
    });
  }

  it("runs the card test of a card the branch changed, as a card-test check", async () => {
    const card = await mb(
      ["card", "create", "--json"],
      JSON.stringify({
        name: "Order totals",
        display: "table",
        visualization_settings: {},
        collection_id: SEEDED.defaultCollectionId,
        dataset_query: {
          type: "native",
          database: SEEDED.warehouseDbId,
          native: { query: "SELECT id, subtotal_cents + tax_cents AS total_cents FROM orders" },
        },
      }),
    );
    expect(card.exitCode, card.stderr).toBe(0);
    const cardId = parseJson(card.stdout, Created).id;
    const full = await mb(["card", "get", String(cardId), "--full", "--json"]);
    const entityId = parseJson(full.stdout, WithEntityId).entity_id;
    const test = await mb(
      ["test", "create", "--id", `card:${cardId}`, "--json"],
      JSON.stringify({
        name: "totals are never negative",
        inputs: [
          {
            table: { schema: "public", name: "orders" },
            format: "rows",
            columns: [
              { name: "id", cast_type: "INTEGER" },
              { name: "subtotal_cents", cast_type: "BIGINT" },
              { name: "tax_cents", cast_type: "BIGINT" },
            ],
            rows: [{ id: 1, subtotal_cents: 100, tax_cents: 10 }],
          },
        ],
        expectations: [
          {
            type: "empty",
            name: "no negative totals",
            sql: "SELECT * FROM {{output}} WHERE total_cents < 0",
          },
        ],
      }),
    );
    expect(test.exitCode, test.stderr).toBe(0);
    const testId = String(parseJson(test.stdout, Created).id);
    const base = await repo.git("rev-parse", "HEAD");
    await repo.git("checkout", "-q", "-b", "feature");
    await repo.put(
      "collections/main/cards/order_totals.yaml",
      `name: Order totals\nentity_id: ${entityId}\nserdes/meta:\n- model: Card\n`,
    );
    await repo.put(
      "collections/main/cards/order_totals/totals_are_never_negative.yaml",
      `entity_id: bRvM7DLesF1fOV4kRHidq\ncard_id: ${entityId}\nexpectations:\n- name: no negative totals\n  type: empty\nserdes/meta:\n- model: CardTest\n`,
    );
    const head = await repo.commitAll("add card and its test");

    const result = await mb(["ci", "run", "--repo", repo.path, "--base", "main"]);

    expect(result.exitCode, result.stderr).toBe(0);
    const events = result.stdout
      .trimEnd()
      .split("\n")
      .map((line) => parseJson(line, CiEvent));
    expect(events).toEqual(
      sequenced(
        [
          {
            type: "job.start",
            v: 2,
            snapshot: { base, head },
            checked: [{ type: "card", entity_id: entityId, name: "Order totals" }],
            warnings: [],
          },
          ...lintStage(),
          { type: "stage.start", stage: "unit" },
          {
            type: "check.result",
            stage: "unit",
            check: {
              kind: "card-test",
              id: testId,
              label: "Order totals: totals are never negative",
            },
            verdict: "passed",
            warnings: [],
            ms: expect.any(Number),
            detail: {
              status: "passed",
              expectations: [{ name: "no negative totals", type: "empty", status: "passed" }],
              tables: expect.any(Object),
            },
          },
          { type: "stage.end", stage: "unit", status: "passed", stopped: null, skipped: null },
          {
            type: "job.end",
            state: "passed",
            counts: { checks: 1 + SAVED_QUERY_CHECKS, warnings: 0 },
          },
        ],
        0,
      ),
    );
  });
});

const actionUnitSkipReason = requireServer("ci › unit stage › action tests", [
  "actionTests",
  "dataActionsWithoutModel",
]);

describe.skipIf(actionUnitSkipReason !== null)("ci e2e › unit stage › action tests", () => {
  const tempDirs: string[] = [];
  let repo: TempGitRepo;
  let bootstrap: E2EBootstrap;

  beforeAll(async () => {
    bootstrap = await readBootstrap();
  });

  beforeEach(async () => {
    repo = await createTempGitRepo();
  });

  afterEach(async () => {
    await repo.remove();
    await Promise.all(tempDirs.splice(0).map(cleanupConfigHome));
  });

  async function mb(args: string[], stdin?: string): Promise<RunCliResult> {
    const dir = await mkTempConfigHome();
    tempDirs.push(dir);
    return runCli({
      args,
      configHome: dir,
      env: { MB_URL: bootstrap.baseUrl, MB_API_KEY: bootstrap.adminApiKey },
      ...(stdin === undefined ? {} : { stdin }),
    });
  }

  it("runs the action test of an action the branch changed, as an action-test check", async () => {
    const enabled = await mb(["db", "set-data-actions", String(SEEDED.warehouseDbId), "true"]);
    expect(enabled.exitCode, enabled.stderr).toBe(0);
    const action = await mb(
      ["data-action", "create", "--json"],
      JSON.stringify({
        name: "Rename customer",
        type: "query",
        collection_id: null,
        dataset_query: {
          "lib/type": "mbql/query",
          database: SEEDED.warehouseDbId,
          stages: [
            {
              "lib/type": "mbql.stage/native",
              native: "UPDATE customers SET full_name = {{full_name}} WHERE id = {{customer_id}}",
              "template-tags": {
                customer_id: {
                  id: "customer_id",
                  name: "customer_id",
                  "display-name": "Customer ID",
                  type: "number",
                  required: true,
                },
                full_name: {
                  id: "full_name",
                  name: "full_name",
                  "display-name": "Full name",
                  type: "text",
                  required: true,
                },
              },
            },
          ],
        },
        parameters: [
          {
            id: "customer_id",
            slug: "customer_id",
            name: "Customer ID",
            type: "number/=",
            target: ["variable", ["template-tag", "customer_id"]],
            required: true,
          },
          {
            id: "full_name",
            slug: "full_name",
            name: "Full name",
            type: "string/=",
            target: ["variable", ["template-tag", "full_name"]],
            required: true,
          },
        ],
      }),
    );
    expect(action.exitCode, action.stderr).toBe(0);
    const actionId = parseJson(action.stdout, Created).id;
    const full = await mb(["data-action", "get", String(actionId), "--full", "--json"]);
    const entityId = parseJson(full.stdout, WithEntityId).entity_id;
    const test = await mb(
      ["test", "create", "--id", `action:${actionId}`, "--json"],
      JSON.stringify({
        name: "renames one customer",
        parameters: { customer_id: 1, full_name: "Ada Lovelace" },
        inputs: [
          {
            table: { schema: "public", name: "customers" },
            format: "rows",
            columns: [
              { name: "id", cast_type: "INTEGER" },
              { name: "full_name", cast_type: "TEXT" },
            ],
            rows: [
              { id: 1, full_name: "Ada" },
              { id: 2, full_name: "Grace" },
            ],
          },
        ],
        expectations: [
          {
            type: "empty",
            name: "only customer 1 is renamed",
            sql: "SELECT * FROM public.customers WHERE (id = 1 AND full_name <> 'Ada Lovelace') OR (id = 2 AND full_name <> 'Grace')",
          },
        ],
      }),
    );
    expect(test.exitCode, test.stderr).toBe(0);
    const testId = String(parseJson(test.stdout, Created).id);
    const base = await repo.git("rev-parse", "HEAD");
    await repo.git("checkout", "-q", "-b", "feature");
    await repo.put(
      "actions/rename_customer.yaml",
      `name: Rename customer\nentity_id: ${entityId}\nserdes/meta:\n- model: Action\n`,
    );
    await repo.put(
      "actions/rename_customer/renames_one_customer.yaml",
      `entity_id: cRvM7DLesF1fOV4kRHidq\naction_id: ${entityId}\nparameters:\n  customer_id: 1\n  full_name: Ada Lovelace\nexpectations:\n- name: only customer 1 is renamed\n  type: empty\nserdes/meta:\n- model: ActionTest\n`,
    );
    const head = await repo.commitAll("add action and its test");

    const result = await mb(["ci", "run", "--repo", repo.path, "--base", "main"]);

    expect(result.exitCode, result.stderr).toBe(0);
    const events = result.stdout
      .trimEnd()
      .split("\n")
      .map((line) => parseJson(line, CiEvent));
    expect(events).toEqual(
      sequenced(
        [
          {
            type: "job.start",
            v: 2,
            snapshot: { base, head },
            checked: [{ type: "action", entity_id: entityId, name: "Rename customer" }],
            warnings: [],
          },
          ...lintStage(),
          { type: "stage.start", stage: "unit" },
          {
            type: "check.result",
            stage: "unit",
            check: {
              kind: "action-test",
              id: testId,
              label: "Rename customer: renames one customer",
            },
            verdict: "passed",
            warnings: [],
            ms: expect.any(Number),
            detail: {
              status: "passed",
              expectations: [
                { name: "only customer 1 is renamed", type: "empty", status: "passed" },
              ],
              tables: expect.any(Object),
            },
          },
          { type: "stage.end", stage: "unit", status: "passed", stopped: null, skipped: null },
          {
            type: "job.end",
            state: "passed",
            counts: { checks: 1 + SAVED_QUERY_CHECKS, warnings: 0 },
          },
        ],
        0,
      ),
    );
  });
});
