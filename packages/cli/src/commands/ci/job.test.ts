import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ConfigError, isFileNotFoundError } from "@metabase/client/errors";
import { parseJson } from "@metabase/client/json";
import { z } from "zod";

import { type CiEvent, type CiStage, CiEvent as CiEventSchema } from "../../core/ci-events";
import { type TempGitRepo, createTempGitRepo } from "../../runtime/temp-git-repo";

import { runJob } from "./job";

const NOW = new Date("2026-10-30T12:00:00.000Z");
const AT = "2026-10-30T12:00:00.000Z";
const TRANSFORM_ID = "7JwIkkAG-06-nsl4jzsaq";

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
    },
  };
}

describe("runJob", () => {
  it("emits job.start, the stages and job.end, counting the plan's warnings too", async () => {
    const base = await repo.git("rev-parse", "HEAD");
    await repo.git("checkout", "-q", "-b", "feature");
    await repo.put(
      "transforms/daily.yaml",
      `name: Daily\nentity_id: ${TRANSFORM_ID}\nserdes/meta:\n- model: Transform\n`,
    );
    const head = await repo.commitAll("add transform");
    await repo.put("transforms/draft.yaml", "draft\n");
    const events: CiEvent[] = [];

    const state = await runJob({
      repo: repo.path,
      base: "main",
      head: "HEAD",
      stages: [failingStage()],
      job: "job-1",
      now: () => NOW,
      write: (event) => events.push(event),
      resultsPath: null,
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
      { ...envelope, seq: 3, type: "stage.end", stage: "unit", status: "failed" },
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
      stages: [failingStage()],
      job: "job-1",
      now: () => NOW,
      write: (event) => events.push(event),
      resultsPath,
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

  it("leaves job.end off the stream when the results file cannot be written", async () => {
    const events: CiEvent[] = [];
    const job = runJob({
      repo: repo.path,
      base: "main",
      head: "HEAD",
      stages: [],
      job: "job-1",
      now: () => NOW,
      write: (event) => events.push(event),
      resultsPath: join(repo.path, "no-such-dir", "results.json"),
    });

    await expect(job).rejects.toThrow("ENOENT");
    expect(events.map((event) => event.type)).toEqual(["job.start"]);
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
        stages: [],
        job: "job-1",
        now: () => NOW,
        write: (event) => events.push(event),
        resultsPath,
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
      stages: [],
      job: "job-1",
      now: () => NOW,
      write: (event) => events.push(event),
      resultsPath,
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
});
