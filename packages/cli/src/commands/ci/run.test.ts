import { runCommand } from "citty";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parseJson } from "@metabase/client/json";

import { CiEvent, type JobState } from "../../core/ci-events";
import { type TempGitRepo, createTempGitRepo } from "../../runtime/temp-git-repo";

interface StubbedState {
  value: JobState | null;
}

const stubbed = vi.hoisted((): StubbedState => ({ value: null }));

vi.mock("./job", async (importOriginal) => {
  const real = await importOriginal<typeof import("./job")>();
  return {
    runJob: async (options: Parameters<typeof real.runJob>[0]) =>
      stubbed.value === null ? real.runJob(options) : stubbed.value,
  };
});

const { default: runCmd } = await import("./run");

const A = "7JwIkkAG-06-nsl4jzsaq";
const previousExitCode = process.exitCode;

interface CliRun {
  stdout: string;
  stderr: string;
  exitCode: number;
}

let repo: TempGitRepo;

beforeEach(async () => {
  repo = await createTempGitRepo();
  stubbed.value = null;
  process.exitCode = undefined;
});

afterEach(async () => {
  vi.restoreAllMocks();
  process.exitCode = previousExitCode;
  await repo.remove();
});

async function run(args: string[]): Promise<CliRun> {
  let stdout = "";
  let stderr = "";
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout += String(chunk);
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr += String(chunk);
    return true;
  });
  try {
    await runCommand(runCmd, { rawArgs: args });
  } finally {
    vi.restoreAllMocks();
  }
  const exitCode = typeof process.exitCode === "number" ? process.exitCode : 0;
  return { stdout, stderr, exitCode };
}

function events(output: string): CiEvent[] {
  return output
    .trimEnd()
    .split("\n")
    .map((line) => parseJson(line, CiEvent));
}

describe("ci run: exit codes", () => {
  it("exits 0 for a job that passed", async () => {
    stubbed.value = "passed";

    expect((await run(["--repo", repo.path, "--base", "main"])).exitCode).toBe(0);
  });

  it("exits 1 for a job that failed", async () => {
    stubbed.value = "failed";

    expect((await run(["--repo", repo.path, "--base", "main"])).exitCode).toBe(1);
  });

  it("exits 1 for a job that errored", async () => {
    stubbed.value = "errored";

    expect((await run(["--repo", repo.path, "--base", "main"])).exitCode).toBe(1);
  });

  it("exits 2 for a --base that is not a commit", async () => {
    expect((await run(["--repo", repo.path, "--base", "no-such-branch"])).exitCode).toBe(2);
  });

  it("exits 1, not 2, when a changed content file does not parse", async () => {
    await repo.git("checkout", "-q", "-b", "feature");
    await repo.put("transforms/broken.yaml", "name: [unclosed\n");
    await repo.commitAll("add a file that does not parse");

    expect((await run(["--repo", repo.path, "--base", "main"])).exitCode).toBe(1);
  });
});

// The plan's part of `job.start`: the rest names the run, not what it found.
function planOf(output: string) {
  const first = events(output)[0];
  if (first?.type !== "job.start") {
    throw new Error(`expected job.start first, got ${output}`);
  }
  return { checked: first.checked, warnings: first.warnings };
}

describe("ci run: committed content only", () => {
  it("lists no untracked transform, warns about it and exits 0, then checks it once committed", async () => {
    await repo.put(
      "transforms/a.yaml",
      `name: Alpha\nentity_id: ${A}\nserdes/meta:\n- model: Transform\n`,
    );

    const before = await run(["--repo", repo.path, "--base", "main"]);

    expect(before.exitCode).toBe(0);
    expect(planOf(before.stdout)).toEqual({
      checked: [],
      warnings: [
        {
          code: "no-content-changes",
          message: "the change touches no Metabase content files, so CI checked nothing",
        },
        {
          code: "uncommitted-content",
          message:
            "1 content file has uncommitted changes, which CI does not see; it checks the committed version: transforms/a.yaml",
        },
      ],
    });

    await repo.git("checkout", "-q", "-b", "feature");
    await repo.commitAll("add A");
    const after = await run(["--repo", repo.path, "--base", "main"]);

    expect(after.exitCode).toBe(0);
    expect(planOf(after.stdout)).toEqual({
      checked: [{ entity_id: A, name: "Alpha" }],
      warnings: [],
    });
  });
});
