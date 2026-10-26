import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { parseJson } from "@metabase/client/json";

import { CiEvent } from "../../packages/cli/src/core/ci-events";
import { type TempGitRepo, createTempGitRepo } from "../../packages/cli/src/runtime/temp-git-repo";
import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { cliErrorCategory, cliErrorMessage } from "./cli-error";
import { type RunCliResult, cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";
import { SEEDED } from "./seed/seeded";
import { requireServer } from "./server-gate";

const TRANSFORM_ID = "7JwIkkAG-06-nsl4jzsaq";

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

  it("streams one event per line, and writes them to --results, for a job with nothing to check", async () => {
    const base = await repo.git("rev-parse", "HEAD");
    await repo.put(
      "t/draft.yaml",
      `name: Draft\nentity_id: ${TRANSFORM_ID}\nserdes/meta:\n- model: Transform\n`,
    );
    const resultsPath = join(repo.path, "results.json");

    const result = await runCli({
      args: ["ci", "run", "--repo", repo.path, "--base", "main", "--results", resultsPath],
      configHome: await configHome(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const events = result.stdout
      .trimEnd()
      .split("\n")
      .map((line) => parseJson(line, CiEvent));
    const envelope = { job: expect.any(String), at: expect.any(String) };
    expect(events).toEqual([
      {
        ...envelope,
        seq: 0,
        type: "job.start",
        v: 1,
        snapshot: { base, head: base },
        checked: [],
        warnings: [
          {
            code: "uncommitted-content",
            message: "1 content file is not committed, so CI did not check: t/draft.yaml",
          },
        ],
      },
      { ...envelope, seq: 1, type: "job.end", state: "passed", counts: { checks: 0, warnings: 1 } },
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

  it("refuses a changed transform the instance does not have, ending the job errored", async () => {
    await repo.git("checkout", "-q", "-b", "feature");
    await repo.put(
      "t/absent.yaml",
      `name: Absent\nentity_id: ${TRANSFORM_ID}\nserdes/meta:\n- model: Transform\n`,
    );
    await repo.commitAll("add a transform the instance never saw");

    const result = await mb(["ci", "run", "--repo", repo.path, "--base", "main"]);

    expect(result.exitCode).toBe(1);
    const events = result.stdout
      .trimEnd()
      .split("\n")
      .map((line) => parseJson(line, CiEvent));
    expect(
      events.filter((event) => event.type === "check.result" || event.type === "job.end"),
    ).toEqual([
      {
        job: expect.any(String),
        at: expect.any(String),
        seq: 2,
        type: "check.result",
        stage: "unit",
        check: { kind: "transform-test", id: TRANSFORM_ID, label: "Absent" },
        verdict: "refused",
        warnings: [],
        ms: 0,
        detail: {
          error_code: "ci.transform-not-on-instance",
          message:
            "the transform is in the branch but not on the Metabase instance; load the branch into it first",
        },
      },
      {
        job: expect.any(String),
        at: expect.any(String),
        seq: 4,
        type: "job.end",
        state: "errored",
        counts: { checks: 1, warnings: 0 },
      },
    ]);
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
    await repo.git("checkout", "-q", "-b", "feature");
    await repo.put(
      "t/order_totals.yaml",
      `name: Order totals\nentity_id: ${entityId}\nserdes/meta:\n- model: Transform\n`,
    );
    await repo.commitAll("add transform");

    const broken = await mb(["ci", "run", "--repo", repo.path, "--base", "main"]);

    expect(broken.exitCode).toBe(1);
    const brokenEvents = broken.stdout
      .trimEnd()
      .split("\n")
      .map((line) => parseJson(line, CiEvent));
    const check = brokenEvents.find((event) => event.type === "check.result");
    expect(check).toMatchObject({
      verdict: "failed",
      check: { kind: "transform-test", label: "Order totals: total adds tax" },
    });
    expect(JSON.stringify(check)).toContain(
      '"cell-mismatches":[{"column":"total_cents","expected":110,"actual":90}]',
    );
    expect(brokenEvents.at(-1)).toMatchObject({ type: "job.end", state: "failed" });

    const fixed = await mb(
      ["transform", "update", String(transformId), "--json"],
      JSON.stringify(totalsBody("+")),
    );
    expect(fixed.exitCode, fixed.stderr).toBe(0);
    const passing = await mb(["ci", "run", "--repo", repo.path, "--base", "main"]);

    expect(passing.exitCode, passing.stderr).toBe(0);
    const passingEvents = passing.stdout
      .trimEnd()
      .split("\n")
      .map((line) => parseJson(line, CiEvent));
    expect(passingEvents.at(-1)).toMatchObject({
      type: "job.end",
      state: "passed",
      counts: { checks: 1, warnings: 0 },
    });
  });
});
