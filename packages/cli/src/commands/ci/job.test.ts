import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ConfigError, isFileNotFoundError } from "@metabase/client/errors";
import { parseJson } from "@metabase/client/json";
import { z } from "zod";

import { type CiEvent, type CiStage, CiEvent as CiEventSchema } from "../../core/ci-events";
import { type TempGitRepo, createTempGitRepo } from "../../runtime/temp-git-repo";

import { coverageStage, untestedTransforms } from "../../core/ci-coverage";

import { RUN_LOG_DIR, runJob } from "./job";
import { type UnitStagePort, unitStage } from "./unit-stage";

const NOW = new Date("2026-10-30T12:00:00.000Z");
const AT = "2026-10-30T12:00:00.000Z";
const TRANSFORM_ID = "7JwIkkAG-06-nsl4jzsaq";
const NOT_INTERRUPTED = new AbortController().signal;

let repo: TempGitRepo;

beforeEach(async () => {
  repo = await createTempGitRepo();
});

afterEach(async () => {
  await repo.remove();
});

function failingStage(): CiStage {
  return {
    name: "unit",
    run: async (report) => {
      report({
        check: { kind: "transform-test", id: "7", label: "daily totals" },
        verdict: "failed",
        warnings: [{ code: "slow", message: "took 2 s" }],
        ms: 2000,
        detail: null,
      });
      return null;
    },
  };
}

describe("runJob", () => {
  it("emits job.start, the stages and job.end, counting the plan's warnings too", async () => {
    const base = await repo.git("rev-parse", "HEAD");
    await repo.git("checkout", "-q", "-b", "feature");
    await repo.put(
      "transforms/daily.yaml",
      `name: Daily\nentity_id: ${TRANSFORM_ID}\nsource:\n  type: query\ntarget:\n  name: t\nserdes/meta:\n- model: Transform\n`,
    );
    const head = await repo.commitAll("add transform");
    await repo.put("transforms/draft.yaml", "draft\n");
    const events: CiEvent[] = [];

    const state = await runJob({
      repo: repo.path,
      base: "main",
      head: "HEAD",
      stages: async () => [failingStage()],
      job: "job-1",
      now: () => NOW,
      write: (event) => events.push(event),
      resultsPath: null,
      runLog: true,
      signal: NOT_INTERRUPTED,
    });

    const envelope = { job: "job-1", at: AT };
    expect(state).toBe("failed");
    expect(events).toEqual([
      {
        ...envelope,
        seq: 0,
        type: "job.start",
        v: 1,
        snapshot: { base, head },
        checked: [{ entity_id: TRANSFORM_ID, name: "Daily" }],
        warnings: [
          {
            code: "uncommitted-content",
            message:
              "1 content file has uncommitted changes, which CI does not see; it checks the committed version: transforms/draft.yaml",
          },
        ],
      },
      { ...envelope, seq: 1, type: "stage.start", stage: "unit" },
      {
        ...envelope,
        seq: 2,
        type: "check.result",
        stage: "unit",
        check: { kind: "transform-test", id: "7", label: "daily totals" },
        verdict: "failed",
        warnings: [{ code: "slow", message: "took 2 s" }],
        ms: 2000,
        detail: null,
      },
      { ...envelope, seq: 3, type: "stage.end", stage: "unit", status: "failed", stopped: null },
      { ...envelope, seq: 4, type: "job.end", state: "failed", counts: { checks: 1, warnings: 2 } },
    ]);
  });

  it("writes every event to the results file", async () => {
    const resultsPath = join(repo.path, "results.json");
    const events: CiEvent[] = [];

    await runJob({
      repo: repo.path,
      base: "main",
      head: "HEAD",
      stages: async () => [failingStage()],
      job: "job-1",
      now: () => NOW,
      write: (event) => events.push(event),
      resultsPath,
      runLog: true,
      signal: NOT_INTERRUPTED,
    });

    expect(events.map((event) => event.type)).toEqual([
      "job.start",
      "stage.start",
      "check.result",
      "stage.end",
      "job.end",
    ]);
    expect(parseJson(await readFile(resultsPath, "utf8"), z.array(CiEventSchema))).toEqual(events);
  });

  it("logs every event to a run log in the repository, which git ignores", async () => {
    const events: CiEvent[] = [];

    await runJob({
      repo: repo.path,
      base: "main",
      head: "HEAD",
      stages: async () => [failingStage()],
      job: "job-1",
      now: () => NOW,
      write: (event) => events.push(event),
      resultsPath: null,
      runLog: true,
      signal: NOT_INTERRUPTED,
    });

    const log = await readFile(
      join(repo.path, RUN_LOG_DIR, "2026-10-30T12-00-00.000Z-job-1.jsonl"),
      "utf8",
    );
    expect(
      log
        .trimEnd()
        .split("\n")
        .map((line) => parseJson(line, CiEventSchema)),
    ).toEqual(events);
    expect(await repo.git("status", "--porcelain")).toBe("");
  });

  it("writes no run log under runLog false", async () => {
    await runJob({
      repo: repo.path,
      base: "main",
      head: "HEAD",
      stages: async () => [failingStage()],
      job: "job-1",
      now: () => NOW,
      write: () => {},
      resultsPath: null,
      runLog: false,
      signal: NOT_INTERRUPTED,
    });

    const missing = await readFile(join(repo.path, RUN_LOG_DIR, ".gitignore"), "utf8").then(
      () => null,
      (error: unknown) => error,
    );
    expect(isFileNotFoundError(missing)).toBe(true);
  });

  it("keeps the run log of a job that crashes, stopping before job.end", async () => {
    const crashing: CiStage = {
      name: "unit",
      run: async () => {
        throw new Error("boom");
      },
    };
    const job = runJob({
      repo: repo.path,
      base: "main",
      head: "HEAD",
      stages: async () => [crashing],
      job: "job-1",
      now: () => NOW,
      write: () => {},
      resultsPath: null,
      runLog: true,
      signal: NOT_INTERRUPTED,
    });

    await expect(job).rejects.toThrow("boom");
    const log = await readFile(
      join(repo.path, RUN_LOG_DIR, "2026-10-30T12-00-00.000Z-job-1.jsonl"),
      "utf8",
    );
    expect(
      log
        .trimEnd()
        .split("\n")
        .map((line) => parseJson(line, CiEventSchema).type),
    ).toEqual(["job.start", "stage.start"]);
  });

  it("leaves job.end off the stream when the results file cannot be written", async () => {
    const events: CiEvent[] = [];
    const job = runJob({
      repo: repo.path,
      base: "main",
      head: "HEAD",
      stages: async () => [],
      job: "job-1",
      now: () => NOW,
      write: (event) => events.push(event),
      resultsPath: join(repo.path, "no-such-dir", "results.json"),
      runLog: true,
      signal: NOT_INTERRUPTED,
    });

    await expect(job).rejects.toThrow("ENOENT");
    expect(events.map((event) => event.type)).toEqual(["job.start"]);
    const log = await readFile(
      join(repo.path, RUN_LOG_DIR, "2026-10-30T12-00-00.000Z-job-1.jsonl"),
      "utf8",
    );
    expect(
      log
        .trimEnd()
        .split("\n")
        .map((line) => parseJson(line, CiEventSchema)),
    ).toEqual(events);
  });

  it("replaces a symlink at the results path rather than writing through it", async () => {
    const outside = await mkdtemp(join(tmpdir(), "mb-ci-outside-"));
    try {
      const target = join(outside, "target.txt");
      await writeFile(target, "untouched\n", "utf8");
      const resultsPath = join(repo.path, "results.json");
      await symlink(target, resultsPath);
      const events: CiEvent[] = [];

      await runJob({
        repo: repo.path,
        base: "main",
        head: "HEAD",
        stages: async () => [],
        job: "job-1",
        now: () => NOW,
        write: (event) => events.push(event),
        resultsPath,
        runLog: true,
        signal: NOT_INTERRUPTED,
      });

      expect(await readFile(target, "utf8")).toBe("untouched\n");
      expect(parseJson(await readFile(resultsPath, "utf8"), z.array(CiEventSchema))).toEqual(
        events,
      );
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("writes no results file and no job.end when planning fails", async () => {
    const resultsPath = join(repo.path, "results.json");
    const events: CiEvent[] = [];
    const job = runJob({
      repo: repo.path,
      base: "no-such-branch",
      head: "HEAD",
      stages: async () => [],
      job: "job-1",
      now: () => NOW,
      write: (event) => events.push(event),
      resultsPath,
      runLog: true,
      signal: NOT_INTERRUPTED,
    });

    await expect(job).rejects.toThrow(ConfigError);
    await expect(job).rejects.toThrow("--base no-such-branch is not a commit");
    expect(events).toEqual([]);
    const missing = await readFile(resultsPath, "utf8").then(
      () => null,
      (error: unknown) => error,
    );
    expect(isFileNotFoundError(missing)).toBe(true);
  });

  it("deletes an earlier run's results file when the job starts, so a crash leaves none", async () => {
    const resultsPath = join(repo.path, "results.json");
    await writeFile(resultsPath, "[]\n", "utf8");
    const job = runJob({
      repo: repo.path,
      base: "no-such-branch",
      head: "HEAD",
      stages: async () => [],
      job: "job-1",
      now: () => NOW,
      write: () => {},
      resultsPath,
      runLog: true,
      signal: NOT_INTERRUPTED,
    });

    await expect(job).rejects.toThrow(ConfigError);
    await expect(job).rejects.toThrow("--base no-such-branch is not a commit");
    const missing = await readFile(resultsPath, "utf8").then(
      () => null,
      (error: unknown) => error,
    );
    expect(isFileNotFoundError(missing)).toBe(true);
  });
});

// An instance that holds every transform and lists no transform test for any of them.
const INSTANCE_WITH_NO_TESTS: UnitStagePort = {
  lookUpTransforms: async (entityIds) =>
    new Map(entityIds.map((entityId) => [entityId, { kind: "found", id: 1 }])),
  readTransform: async () => {},
  listTests: async () => [],
  runTest: async () => {
    throw new Error("there is no test to run");
  },
  nowMs: () => 0,
};

describe("runJob, with the stages ci run builds", () => {
  it("does not pass an edited transform whose test the instance does not list", async () => {
    const transform = (query: string) =>
      `name: Daily\nentity_id: ${TRANSFORM_ID}\nsource:\n  type: query\n  query: ${query}\ntarget:\n  name: t\nserdes/meta:\n- model: Transform\n`;
    await repo.put("transforms/daily.yaml", transform("SELECT 1"));
    await repo.put(
      "transforms/daily/totals.yaml",
      `name: totals\nentity_id: aRvM7DLesF1fOV4kRHidq\ntransform_id: ${TRANSFORM_ID}\ninputs: []\nexpectations:\n- name: e\n  type: empty\nserdes/meta:\n- model: TransformTest\n`,
    );
    await repo.commitAll("a tested transform on main");
    await repo.git("checkout", "-q", "-b", "feature");
    await repo.put("transforms/daily.yaml", transform("SELECT 2"));
    await repo.commitAll("edit the query");
    const events: CiEvent[] = [];

    const state = await runJob({
      repo: repo.path,
      base: "main",
      head: "HEAD",
      stages: async (plan) => [
        coverageStage(plan.coverage),
        unitStage(
          plan.checked,
          untestedTransforms(plan.coverage),
          async () => INSTANCE_WITH_NO_TESTS,
        ),
      ],
      job: "job-1",
      now: () => NOW,
      write: (event) => events.push(event),
      resultsPath: null,
      runLog: true,
      signal: NOT_INTERRUPTED,
    });

    expect(state).toBe("errored");
    expect(
      events.filter((event) => event.type === "check.result" && event.stage === "unit"),
    ).toEqual([
      {
        job: "job-1",
        at: AT,
        seq: 5,
        type: "check.result",
        stage: "unit",
        check: { kind: "transform-test", id: TRANSFORM_ID, label: "Daily" },
        verdict: "refused",
        warnings: [],
        ms: 0,
        detail: {
          error_code: "ci.no-tests-on-instance",
          message:
            "the branch has a test for this transform, but the Metabase instance lists none, so no test ran; load the branch into it first",
        },
      },
    ]);
  });
});
