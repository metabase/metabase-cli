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

const segmentUnitSkipReason = requireServer("ci › unit stage › segment tests", ["segmentTests"]);

describe.skipIf(segmentUnitSkipReason !== null)("ci e2e › unit stage › segment tests", () => {
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

  it("runs the segment test of a segment the branch changed, as a segment-test check", async () => {
    const segment = await mb(
      ["segment", "create", "--json"],
      JSON.stringify({
        name: "Positive id orders",
        table_id: SEEDED.tables.orders,
        definition: {
          database: SEEDED.warehouseDbId,
          type: "query",
          query: {
            "source-table": SEEDED.tables.orders,
            filter: [">", ["field", SEEDED.fields.ordersId, null], 0],
          },
        },
      }),
    );
    expect(segment.exitCode, segment.stderr).toBe(0);
    const segmentId = parseJson(segment.stdout, Created).id;
    const full = await mb(["segment", "get", String(segmentId), "--full", "--json"]);
    const entityId = parseJson(full.stdout, WithEntityId).entity_id;
    const test = await mb(
      ["test", "create", "--id", `segment:${segmentId}`, "--json"],
      JSON.stringify({
        name: "keeps only positive ids",
        inputs: [
          {
            table: { schema: "public", name: "orders" },
            format: "rows",
            columns: [{ name: "id", cast_type: "INTEGER" }],
            rows: [{ id: 1 }, { id: 0 }],
          },
        ],
        expectations: [
          {
            type: "empty",
            name: "no order without a positive id",
            sql: "SELECT * FROM {{output}} WHERE id <= 0",
          },
        ],
      }),
    );
    expect(test.exitCode, test.stderr).toBe(0);
    const testId = String(parseJson(test.stdout, Created).id);
    const base = await repo.git("rev-parse", "HEAD");
    await repo.git("checkout", "-q", "-b", "feature");
    await repo.put(
      "databases/warehouse/tables/orders/segments/positive_id_orders.yaml",
      `name: Positive id orders\nentity_id: ${entityId}\nserdes/meta:\n- model: Database\n- model: Table\n- model: Segment\n`,
    );
    await repo.put(
      "databases/warehouse/tables/orders/segments/positive_id_orders/keeps_only_positive_ids.yaml",
      `entity_id: dRvM7DLesF1fOV4kRHidq\nsegment_id: ${entityId}\nexpectations:\n- name: no order without a positive id\n  type: empty\nserdes/meta:\n- model: SegmentTest\n`,
    );
    const head = await repo.commitAll("add segment and its test");

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
            checked: [{ type: "segment", entity_id: entityId, name: "Positive id orders" }],
            warnings: [],
          },
          ...lintStage(),
          { type: "stage.start", stage: "unit" },
          {
            type: "check.result",
            stage: "unit",
            check: {
              kind: "segment-test",
              id: testId,
              label: "Positive id orders: keeps only positive ids",
            },
            verdict: "passed",
            warnings: [],
            ms: expect.any(Number),
            detail: {
              status: "passed",
              expectations: [
                { name: "no order without a positive id", type: "empty", status: "passed" },
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
