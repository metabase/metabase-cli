import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { parseJson } from "@metabase/client/json";

import { CiEvent } from "../../packages/cli/src/core/ci-events";
import { type TempGitRepo, createTempGitRepo } from "../../packages/cli/src/runtime/temp-git-repo";
import { cliErrorCategory, cliErrorMessage } from "./cli-error";
import { cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";

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

  it("streams one event per line for the transforms a branch changed, and writes them to --results", async () => {
    const base = await repo.git("rev-parse", "HEAD");
    await repo.git("checkout", "-q", "-b", "feature");
    await repo.put(
      "t/daily.yaml",
      `name: Daily\nentity_id: ${TRANSFORM_ID}\nserdes/meta:\n- model: Transform\n`,
    );
    const head = await repo.commitAll("add transform");
    const resultsPath = join(repo.path, "results.json");

    const result = await runCli({
      args: ["ci", "run", "--repo", repo.path, "--base", "main", "--results", resultsPath],
      configHome: await configHome(),
    });

    expect(result.exitCode).toBe(0);
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
        snapshot: { base, head },
        checked: [{ entity_id: TRANSFORM_ID, name: "Daily" }],
        warnings: [],
      },
      { ...envelope, seq: 1, type: "job.end", state: "passed", counts: { checks: 0, warnings: 0 } },
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
