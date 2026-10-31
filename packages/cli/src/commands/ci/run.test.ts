import { runCommand } from "citty";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { parseJson } from "@metabase/client/json";

import { type TempConfigHome, setupTempConfigHome } from "../../core/auth/temp-config-home";
import { CiEvent, type JobState } from "../../core/ci-events";
import { type TempGitRepo, createTempGitRepo } from "../../runtime/temp-git-repo";

interface StubbedState {
  value: JobState | null;
  // Runs the real plan with no stages, so a test of the plan needs no Metabase server.
  noStages: boolean;
}

const stubbed = vi.hoisted((): StubbedState => ({ value: null, noStages: false }));

vi.mock("./job", async (importOriginal) => {
  const real = await importOriginal<typeof import("./job")>();
  return {
    runJob: async (options: Parameters<typeof real.runJob>[0]) => {
      if (stubbed.value !== null) {
        return stubbed.value;
      }
      return real.runJob(stubbed.noStages ? { ...options, stages: async () => [] } : options);
    },
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
  stubbed.noStages = false;
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
      `name: Alpha\nentity_id: ${A}\nsource:\n  type: query\ntarget:\n  name: t\nserdes/meta:\n- model: Transform\n`,
    );

    const before = await run(["--repo", repo.path, "--base", "main"]);

    expect(before.exitCode).toBe(0);
    expect(planOf(before.stdout)).toEqual({
      checked: [],
      warnings: [
        {
          code: "no-content-changes",
          message: "the change touches no Metabase content files, so no transform test ran",
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
    stubbed.noStages = true;
    const after = await run(["--repo", repo.path, "--base", "main"]);

    expect(after.exitCode).toBe(0);
    expect(planOf(after.stdout)).toEqual({
      checked: [{ entity_id: A, name: "Alpha" }],
      warnings: [],
    });
  });
});

function textOutput(sha: string): string {
  const short = sha.slice(0, 7);
  return `mb ci run  base ${short}  head ${short}  0 transforms checked\n⚠ the change touches no Metabase content files, so no transform test ran\nPASSED (exit 0)\n`;
}

async function withTty<T>(isTty: boolean, body: () => Promise<T>): Promise<T> {
  const previous = process.stdout.isTTY;
  process.stdout.isTTY = isTty;
  try {
    return await body();
  } finally {
    process.stdout.isTTY = previous;
  }
}

describe("ci run: output format", () => {
  it("writes the events as lines for a person under --format text", async () => {
    stubbed.noStages = true;

    const result = await run(["--repo", repo.path, "--base", "main", "--format", "text"]);

    expect(result.stdout).toBe(textOutput(await repo.git("rev-parse", "HEAD")));
  });

  it("writes the --results file as JSON under --format text", async () => {
    stubbed.noStages = true;
    const resultsPath = join(repo.path, "results.json");

    await run([
      "--repo",
      repo.path,
      "--base",
      "main",
      "--format",
      "text",
      "--results",
      resultsPath,
    ]);

    const written = parseJson(await readFile(resultsPath, "utf8"), z.array(CiEvent));
    expect(written.map((event) => event.type)).toEqual(["job.start", "job.end"]);
  });

  it("logs the run under .scratch/ci-runs, and not under --no-run-log", async () => {
    stubbed.noStages = true;

    await run(["--repo", repo.path, "--base", "main", "--json", "--no-run-log"]);
    await expect(readdir(join(repo.path, ".scratch"))).rejects.toThrow("ENOENT");

    await run(["--repo", repo.path, "--base", "main", "--json"]);
    const logs = await readdir(join(repo.path, ".scratch", "ci-runs"));
    expect(logs.filter((name) => name.endsWith(".jsonl"))).toHaveLength(1);
  });

  it("writes one JSON event per line under --json", async () => {
    stubbed.noStages = true;

    const result = await run(["--repo", repo.path, "--base", "main", "--json"]);

    expect(events(result.stdout).map((event) => event.type)).toEqual(["job.start", "job.end"]);
  });

  it("writes text by default on a terminal", async () => {
    stubbed.noStages = true;

    const result = await withTty(true, () => run(["--repo", repo.path, "--base", "main"]));

    expect(result.stdout).toBe(textOutput(await repo.git("rev-parse", "HEAD")));
  });

  it("writes JSON by default when stdout is not a terminal", async () => {
    stubbed.noStages = true;

    const result = await withTty(false, () => run(["--repo", repo.path, "--base", "main"]));

    expect(events(result.stdout).map((event) => event.type)).toEqual(["job.start", "job.end"]);
  });
});

const MB_URL = "https://mb.example.com";
const TRANSFORM_ID = 3;
const TEST_ID = 4;

const LICENSED = {
  version: { tag: "v1.65.0" },
  "token-features": { transforms: true, "transforms-testing": true },
};

const TRANSFORM = {
  id: TRANSFORM_ID,
  name: "Alpha",
  description: null,
  source: { type: "query", query: { database: 1, type: "native", native: { query: "select 1" } } },
  target: { type: "table", database: 1, schema: "public", name: "alpha" },
  source_type: "native",
  entity_id: A,
  created_at: "2026-10-30T12:00:00Z",
  updated_at: "2026-10-30T12:00:00Z",
  creator_id: 1,
  collection_id: null,
  target_table_id: 42,
};

const TEST = {
  id: TEST_ID,
  entity_id: "test-4xxxxxxxxxxxxxxxx",
  transform_id: TRANSFORM_ID,
  creator_id: 1,
  name: "total adds tax",
  description: null,
  inputs: [],
  expectations: [],
  created_at: "2026-10-30T12:00:00Z",
  updated_at: "2026-10-30T12:00:00Z",
};

const PASSED_RUN = {
  status: "passed",
  tables: {},
  expectations: [{ name: "e", type: "empty", status: "passed" }],
};

const FAILED_RUN = {
  status: "failed",
  tables: {},
  expectations: [
    { name: "e", type: "empty", status: "failed", columns: [], sample: [], truncated: 0 },
  ],
};

const MANY_ROWS_RUN = {
  status: "failed",
  tables: {},
  expectations: [
    {
      name: "e",
      type: "empty",
      status: "failed",
      columns: [{ name: "id", database_type: "int8" }],
      sample: [{ id: 0 }, { id: 1 }, { id: 2 }, { id: 3 }],
      truncated: 0,
    },
  ],
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

interface FakeMetabase {
  properties: unknown;
  list: () => Response;
  run: () => Response;
}

// Answers by route, so a test does not depend on how many probes the client makes.
function serveMetabase(fake: FakeMetabase): void {
  vi.stubGlobal("fetch", async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = new URL(url).pathname;
    if (path === "/api/session/properties") {
      return json(fake.properties);
    }
    if (path === "/api/eid-translation/translate") {
      return json({ entity_ids: { [A]: { status: "ok", type: "transform", id: TRANSFORM_ID } } });
    }
    if (path === `/api/transform/${TRANSFORM_ID}`) {
      return json(TRANSFORM);
    }
    if (path === "/api/ee/transform-test") {
      return fake.list();
    }
    if (path === `/api/ee/transform-test/${TEST_ID}/run`) {
      return fake.run();
    }
    return json("API endpoint does not exist.", 404);
  });
}

// The detail of the unit stage's one check, the sixth event of a job that checks one transform.
function unitDetail(all: readonly CiEvent[]): unknown {
  const check = all[5];
  if (check?.type !== "check.result") {
    throw new Error(`expected a check.result sixth, got ${JSON.stringify(all)}`);
  }
  return check.detail;
}

function serveRun(answer: () => Response): void {
  serveMetabase({ properties: LICENSED, list: () => json([TEST]), run: answer });
}

describe("ci run: a changed transform tested on Metabase", () => {
  let home: TempConfigHome;

  beforeEach(async () => {
    home = setupTempConfigHome();
    process.env["MB_URL"] = MB_URL;
    process.env["MB_API_KEY"] = "mb_ci_test_key";
    process.env["MB_CLI_DISABLE_KEYRING"] = "1";
    await repo.git("checkout", "-q", "-b", "feature");
    await repo.put(
      "transforms/a.yaml",
      `name: Alpha\nentity_id: ${A}\nsource:\n  type: query\ntarget:\n  name: t\nserdes/meta:\n- model: Transform\n`,
    );
    await repo.put(
      "transforms/a/test.yaml",
      `entity_id: aRvM7DLesF1fOV4kRHidq\ntransform_id: ${A}\nexpectations:\n- name: e\n  type: empty\nserdes/meta:\n- model: TransformTest\n`,
    );
    await repo.commitAll("add A");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    home.cleanup();
  });

  function lastTwo(output: string): CiEvent[] {
    return events(output).slice(-2);
  }

  const envelope = { job: expect.any(String), at: expect.any(String) };

  it("checks the transform, and a failed expectation ends the job failed with exit code 1", async () => {
    serveRun(() => json(FAILED_RUN));

    const result = await run(["--repo", repo.path, "--base", "main"]);

    expect(result.exitCode).toBe(1);
    expect(events(result.stdout).map((event) => event.type)).toEqual([
      "job.start",
      "stage.start",
      "check.result",
      "stage.end",
      "stage.start",
      "check.result",
      "stage.end",
      "job.end",
    ]);
    expect(planOf(result.stdout).checked).toEqual([{ entity_id: A, name: "Alpha" }]);
    expect(lastTwo(result.stdout)).toEqual([
      { ...envelope, seq: 6, type: "stage.end", stage: "unit", status: "failed", stopped: null },
      { ...envelope, seq: 7, type: "job.end", state: "failed", counts: { checks: 2, warnings: 0 } },
    ]);
  });

  it("ends the job passed with exit code 0 when the test passes", async () => {
    serveRun(() => json(PASSED_RUN));

    const result = await run(["--repo", repo.path, "--base", "main"]);

    expect([result.exitCode, events(result.stdout).at(-1)]).toEqual([
      0,
      { ...envelope, seq: 7, type: "job.end", state: "passed", counts: { checks: 2, warnings: 0 } },
    ]);
  });

  it("refuses a test Metabase will not run, ending the job errored with exit code 1", async () => {
    serveRun(() =>
      json(
        {
          message: "An input is declared for a table the transform never reads.",
          "error-code": "transform-test.unused-inputs",
        },
        400,
      ),
    );

    const result = await run(["--repo", repo.path, "--base", "main"]);

    expect(result.exitCode).toBe(1);
    expect(events(result.stdout).slice(5)).toEqual([
      {
        ...envelope,
        seq: 5,
        type: "check.result",
        stage: "unit",
        check: { kind: "transform-test", id: String(TEST_ID), label: "Alpha: total adds tax" },
        verdict: "refused",
        warnings: [],
        ms: expect.any(Number),
        detail: {
          error_code: "transform-test.unused-inputs",
          message: "An input is declared for a table the transform never reads.",
          tables: null,
        },
      },
      { ...envelope, seq: 6, type: "stage.end", stage: "unit", status: "errored", stopped: null },
      {
        ...envelope,
        seq: 7,
        type: "job.end",
        state: "errored",
        counts: { checks: 2, warnings: 0 },
      },
    ]);
  });

  it("reports a 500 from a test run as an error check, ending the job errored with a results file", async () => {
    serveRun(() => json({ message: "boom" }, 500));
    const resultsPath = join(repo.path, "results.json");

    const result = await run(["--repo", repo.path, "--base", "main", "--results", resultsPath]);

    expect(result.exitCode).toBe(1);
    expect(events(result.stdout).at(5)).toEqual({
      ...envelope,
      seq: 5,
      type: "check.result",
      stage: "unit",
      check: { kind: "transform-test", id: String(TEST_ID), label: "Alpha: total adds tax" },
      verdict: "error",
      warnings: [],
      ms: expect.any(Number),
      detail: { error_code: "ci.http-error", status: 500, message: "boom" },
    });
    expect(parseJson(await readFile(resultsPath, "utf8"), z.array(CiEvent))).toEqual(
      events(result.stdout),
    );
  });

  it("writes every row to JSON stdout whatever --max-rows says", async () => {
    serveRun(() => json(MANY_ROWS_RUN));

    const result = await run(["--repo", repo.path, "--base", "main", "--json", "--max-rows", "1"]);

    expect(unitDetail(events(result.stdout))).toEqual(MANY_ROWS_RUN);
  });

  it("shows --max-rows rows of a failed expectation under --format text", async () => {
    serveRun(() => json(MANY_ROWS_RUN));

    const result = await run([
      "--repo",
      repo.path,
      "--base",
      "main",
      "--format",
      "text",
      "--max-rows",
      "1",
    ]);

    expect(result.stdout.split("\n").filter((line) => line.startsWith("          "))).toEqual([
      "          row  id=0",
      "          +3 more",
    ]);
  });

  it("exits 2 for a negative --max-rows", async () => {
    expect((await run(["--repo", repo.path, "--base", "main", "--max-rows", "-1"])).exitCode).toBe(
      2,
    );
  });

  it("stops the unit stage on a rejected credential, ending the job errored with a results file", async () => {
    serveRun(() => json({ message: "Unauthenticated" }, 401));
    const resultsPath = join(repo.path, "results.json");

    const result = await run(["--repo", repo.path, "--base", "main", "--results", resultsPath]);

    expect(result.exitCode).toBe(1);
    expect(lastTwo(result.stdout)).toEqual([
      {
        ...envelope,
        seq: 5,
        type: "stage.end",
        stage: "unit",
        status: "errored",
        stopped: { code: "ci.unauthorized", message: "Unauthenticated" },
      },
      {
        ...envelope,
        seq: 6,
        type: "job.end",
        state: "errored",
        counts: { checks: 1, warnings: 0 },
      },
    ]);
    expect(parseJson(await readFile(resultsPath, "utf8"), z.array(CiEvent))).toEqual(
      events(result.stdout),
    );
  });

  it("stops the unit stage on a server without transform testing, exiting 1 rather than 2", async () => {
    serveMetabase({
      properties: { version: { tag: "v1.65.0" }, "token-features": { transforms: true } },
      list: () => json("This API endpoint is only enabled if you have a premium token.", 402),
      run: () => json(PASSED_RUN),
    });

    const result = await run(["--repo", repo.path, "--base", "main"]);

    expect([result.exitCode, lastTwo(result.stdout)]).toEqual([
      1,
      [
        {
          ...envelope,
          seq: 5,
          type: "stage.end",
          stage: "unit",
          status: "errored",
          stopped: {
            code: "ci.unsupported-server",
            message:
              "This operation requires the 'transforms-testing' premium feature (not enabled on this server).",
          },
        },
        {
          ...envelope,
          seq: 6,
          type: "job.end",
          state: "errored",
          counts: { checks: 1, warnings: 0 },
        },
      ],
    ]);
  });

  it("refuses the transform when the instance lists none of the tests the branch holds, ending the job errored", async () => {
    serveMetabase({ properties: LICENSED, list: () => json([]), run: () => json(PASSED_RUN) });

    const result = await run(["--repo", repo.path, "--base", "main"]);

    expect(result.exitCode).toBe(1);
    expect(events(result.stdout).slice(5)).toEqual([
      {
        ...envelope,
        seq: 5,
        type: "check.result",
        stage: "unit",
        check: { kind: "transform-test", id: A, label: "Alpha" },
        verdict: "refused",
        warnings: [],
        ms: expect.any(Number),
        detail: {
          error_code: "ci.no-tests-on-instance",
          message:
            "the branch has a test for this transform, but the Metabase instance lists none, so no test ran; load the branch into it first",
        },
      },
      { ...envelope, seq: 6, type: "stage.end", stage: "unit", status: "errored", stopped: null },
      {
        ...envelope,
        seq: 7,
        type: "job.end",
        state: "errored",
        counts: { checks: 2, warnings: 0 },
      },
    ]);
  });

  it("passes a new Python transform without a test, warning that it cannot have one", async () => {
    await repo.git("rm", "-q", "transforms/a/test.yaml");
    await repo.put(
      "transforms/a.yaml",
      `name: Alpha\nentity_id: ${A}\nsource:\n  type: python\n  body: print(1)\ntarget:\n  name: t\nserdes/meta:\n- model: Transform\n`,
    );
    await repo.commitAll("make A a Python transform without a test");
    serveMetabase({ properties: LICENSED, list: () => json([]), run: () => json(PASSED_RUN) });

    const result = await run(["--repo", repo.path, "--base", "main"]);

    expect(result.exitCode).toBe(0);
    expect(events(result.stdout).slice(1)).toEqual([
      { ...envelope, seq: 1, type: "stage.start", stage: "lint" },
      {
        ...envelope,
        seq: 2,
        type: "check.result",
        stage: "lint",
        check: {
          kind: "coverage",
          id: "untestable",
          label: "Transforms that cannot have transform tests",
        },
        verdict: "passed",
        warnings: [
          {
            code: "untestable-transform",
            message:
              "Alpha cannot have transform tests (Python transforms), so coverage does not require one",
          },
        ],
        ms: 0,
        detail: { untestable: [{ entity_id: A, name: "Alpha" }] },
      },
      {
        ...envelope,
        seq: 3,
        type: "check.result",
        stage: "lint",
        check: {
          kind: "coverage",
          id: "untouched",
          label: "Transforms whose logic this change did not touch",
        },
        verdict: "passed",
        warnings: [],
        ms: 0,
        detail: { untested: [] },
      },
      { ...envelope, seq: 4, type: "stage.end", stage: "lint", status: "passed", stopped: null },
      { ...envelope, seq: 5, type: "stage.start", stage: "unit" },
      { ...envelope, seq: 6, type: "stage.end", stage: "unit", status: "passed", stopped: null },
      { ...envelope, seq: 7, type: "job.end", state: "passed", counts: { checks: 2, warnings: 1 } },
    ]);
  });

  it("runs the unit stage after lint fails a new untested transform, ending the job failed", async () => {
    await repo.git("rm", "-q", "transforms/a/test.yaml");
    await repo.commitAll("drop A's test");
    serveMetabase({ properties: LICENSED, list: () => json([]), run: () => json(PASSED_RUN) });

    const result = await run(["--repo", repo.path, "--base", "main"]);

    expect([result.exitCode, events(result.stdout).slice(4)]).toEqual([
      1,
      [
        { ...envelope, seq: 4, type: "stage.end", stage: "lint", status: "failed", stopped: null },
        { ...envelope, seq: 5, type: "stage.start", stage: "unit" },
        { ...envelope, seq: 6, type: "stage.end", stage: "unit", status: "passed", stopped: null },
        {
          ...envelope,
          seq: 7,
          type: "job.end",
          state: "failed",
          counts: { checks: 2, warnings: 0 },
        },
      ],
    ]);
  });

  it("ends the job errored, not exit 2, when no Metabase credential is configured", async () => {
    delete process.env["MB_URL"];
    delete process.env["MB_API_KEY"];
    serveRun(() => json(PASSED_RUN));

    const result = await run(["--repo", repo.path, "--base", "main"]);

    expect([result.exitCode, events(result.stdout).slice(-2)]).toEqual([
      1,
      [
        {
          ...envelope,
          seq: 5,
          type: "stage.end",
          stage: "unit",
          status: "errored",
          stopped: {
            code: "ci.no-credential",
            message: expect.stringContaining(
              "no Metabase credential, so the transform tests did not run: Not authenticated for profile",
            ),
          },
        },
        {
          ...envelope,
          seq: 6,
          type: "job.end",
          state: "errored",
          counts: { checks: 1, warnings: 0 },
        },
      ],
    ]);
  });
});

describe("ci run: the lint stage, with no Metabase credential", () => {
  let home: TempConfigHome;
  const envelope = { job: expect.any(String), at: expect.any(String) };
  const untouchedCheck = {
    kind: "coverage",
    id: "untouched",
    label: "Transforms whose logic this change did not touch",
  };

  beforeEach(() => {
    home = setupTempConfigHome();
    delete process.env["MB_URL"];
    delete process.env["MB_API_KEY"];
    delete process.env["MB_PROFILE"];
    process.env["MB_CLI_DISABLE_KEYRING"] = "1";
  });

  afterEach(() => {
    home.cleanup();
  });

  it("fails the job on lint's finding, ending the unit stage without a credential rather than exiting 2", async () => {
    await repo.git("checkout", "-q", "-b", "feature");
    await repo.put(
      "transforms/a.yaml",
      `name: Alpha\nentity_id: ${A}\nsource:\n  type: query\ntarget:\n  name: t\nserdes/meta:\n- model: Transform\n`,
    );
    await repo.commitAll("add an untested transform");

    const result = await run(["--repo", repo.path, "--base", "main"]);

    expect(result.exitCode).toBe(1);
    expect(events(result.stdout).slice(1)).toEqual([
      { ...envelope, seq: 1, type: "stage.start", stage: "lint" },
      {
        ...envelope,
        seq: 2,
        type: "check.result",
        stage: "lint",
        check: { kind: "coverage", id: A, label: "Alpha" },
        verdict: "failed",
        warnings: [],
        ms: 0,
        detail: {
          change: "new",
          message: "Alpha is new in this change and has no transform tests",
        },
      },
      {
        ...envelope,
        seq: 3,
        type: "check.result",
        stage: "lint",
        check: untouchedCheck,
        verdict: "passed",
        warnings: [],
        ms: 0,
        detail: { untested: [] },
      },
      { ...envelope, seq: 4, type: "stage.end", stage: "lint", status: "failed", stopped: null },
      { ...envelope, seq: 5, type: "stage.start", stage: "unit" },
      {
        ...envelope,
        seq: 6,
        type: "stage.end",
        stage: "unit",
        status: "errored",
        stopped: {
          code: "ci.no-credential",
          message: expect.stringContaining(
            "no Metabase credential, so the transform tests did not run: Not authenticated for profile",
          ),
        },
      },
      { ...envelope, seq: 7, type: "job.end", state: "failed", counts: { checks: 2, warnings: 0 } },
    ]);
  });

  it("runs only the lint stage, warning without failing, when no transform needs a test run", async () => {
    await repo.put(
      "transforms/a.yaml",
      `name: Alpha\nentity_id: ${A}\nsource:\n  type: query\ntarget:\n  name: t\nserdes/meta:\n- model: Transform\n`,
    );
    await repo.commitAll("an untested transform on main");
    await repo.git("checkout", "-q", "-b", "feature");
    await repo.put("README.md", "changed\n");
    await repo.commitAll("touch no content file");

    const result = await run(["--repo", repo.path, "--base", "main"]);

    expect(result.exitCode).toBe(0);
    expect(events(result.stdout).slice(1)).toEqual([
      { ...envelope, seq: 1, type: "stage.start", stage: "lint" },
      {
        ...envelope,
        seq: 2,
        type: "check.result",
        stage: "lint",
        check: untouchedCheck,
        verdict: "passed",
        warnings: [
          {
            code: "no-tests-untouched",
            message: "1 transform whose logic this change did not touch has no tests: Alpha",
          },
        ],
        ms: 0,
        detail: { untested: [{ entity_id: A, name: "Alpha" }] },
      },
      { ...envelope, seq: 3, type: "stage.end", stage: "lint", status: "passed", stopped: null },
      { ...envelope, seq: 4, type: "job.end", state: "passed", counts: { checks: 1, warnings: 2 } },
    ]);
  });
});
