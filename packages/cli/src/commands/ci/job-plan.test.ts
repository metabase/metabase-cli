import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ConfigError, ValidationError } from "@metabase/client/errors";

import { type TempGitRepo, createTempGitRepo } from "../../runtime/temp-git-repo";

import { planJob } from "./job-plan";

const TRANSFORM_ID = "7JwIkkAG-06-nsl4jzsaq";
const OTHER_TRANSFORM_ID = "7XqqzlsonSq4KFyOvtrAm";
const TRANSFORM_PATH = "collections/transforms/daily.yaml";
const TEST_PATH = "collections/transforms/daily/totals.yaml";

function transformYaml(entityId: string, name: string): string {
  return `name: ${name}\nentity_id: ${entityId}\nserdes/meta:\n- model: Transform\n`;
}

function testYaml(transformId: string): string {
  return `entity_id: aRvM7DLesF1fOV4kRHidq\ntransform_id: ${transformId}\nserdes/meta:\n- model: TransformTest\n`;
}

const TRANSFORM_YAML = transformYaml(TRANSFORM_ID, "Daily Order Summary");
const TEST_YAML = testYaml(TRANSFORM_ID);
const DAILY = { entity_id: TRANSFORM_ID, name: "Daily Order Summary" };
const BROKEN_QUERY = "source:\n  query: select broken(\n";
const LARGE_DIFF_FILES = 1800;
const LARGE_DIFF_TIMEOUT_MS = 60_000;

let repo: TempGitRepo;

beforeEach(async () => {
  repo = await createTempGitRepo();
});

afterEach(async () => {
  await repo.remove();
});

describe("planJob", () => {
  it("checks nothing and warns when the only new transform is not committed", async () => {
    const base = await repo.git("rev-parse", "HEAD");
    await repo.put(TRANSFORM_PATH, TRANSFORM_YAML);

    expect(await planJob(repo.path, "main", "HEAD")).toEqual({
      snapshot: { base, head: base },
      checked: [],
      warnings: [
        {
          code: "uncommitted-content",
          message: `1 content file has uncommitted changes, which CI does not see; it checks the committed version: ${TRANSFORM_PATH}`,
        },
      ],
    });
  });

  it("checks a transform once it is committed on the branch", async () => {
    const base = await repo.git("rev-parse", "HEAD");
    await repo.git("checkout", "-q", "-b", "feature");
    await repo.put(TRANSFORM_PATH, TRANSFORM_YAML);
    const head = await repo.commitAll("add transform");

    expect(await planJob(repo.path, "main", "HEAD")).toEqual({
      snapshot: { base, head },
      checked: [DAILY],
      warnings: [],
    });
  });

  it("names a transform whose own file is unchanged when only its test changed", async () => {
    await repo.put(TRANSFORM_PATH, TRANSFORM_YAML);
    const base = await repo.commitAll("add transform");
    await repo.git("checkout", "-q", "-b", "feature");
    await repo.put(TEST_PATH, TEST_YAML);
    const head = await repo.commitAll("add test");

    expect(await planJob(repo.path, "main", "HEAD")).toEqual({
      snapshot: { base, head },
      checked: [DAILY],
      warnings: [],
    });
  });

  it("ignores changes made on the base branch after the branch forked", async () => {
    await repo.git("checkout", "-q", "-b", "feature");
    await repo.put(TRANSFORM_PATH, TRANSFORM_YAML);
    const head = await repo.commitAll("add transform on the branch");
    await repo.git("checkout", "-q", "main");
    await repo.put(
      "collections/transforms/other.yaml",
      transformYaml(OTHER_TRANSFORM_ID, "Hourly Stats"),
    );
    const base = await repo.commitAll("add another transform on main");
    await repo.git("checkout", "-q", "feature");

    expect(await planJob(repo.path, "main", "HEAD")).toEqual({
      snapshot: { base, head },
      checked: [DAILY],
      warnings: [],
    });
  });

  it("checks a renamed transform once, reading its old path at the merge base", async () => {
    await repo.put(TRANSFORM_PATH, TRANSFORM_YAML);
    const base = await repo.commitAll("add transform");
    await repo.git("checkout", "-q", "-b", "feature");
    await repo.git("mv", TRANSFORM_PATH, "collections/transforms/renamed.yaml");
    const head = await repo.commitAll("rename transform");

    expect(await planJob(repo.path, "main", "HEAD")).toEqual({
      snapshot: { base, head },
      checked: [DAILY],
      warnings: [],
    });
  });

  it("works from a subdirectory of the repository, finding transforms anywhere in it", async () => {
    await repo.put(TRANSFORM_PATH, TRANSFORM_YAML);
    const base = await repo.commitAll("add transform");
    await repo.git("checkout", "-q", "-b", "feature");
    await repo.put(TEST_PATH, TEST_YAML);
    const head = await repo.commitAll("add test");
    await repo.put("other/README.md", "elsewhere\n");
    await repo.commitAll("add other dir");

    expect(await planJob(`${repo.path}/other`, "main", head)).toEqual({
      snapshot: { base, head },
      checked: [DAILY],
      warnings: [],
    });
  });

  it("warns about a changed test whose transform is not in the repo", async () => {
    const base = await repo.git("rev-parse", "HEAD");
    await repo.git("checkout", "-q", "-b", "feature");
    await repo.put(TEST_PATH, TEST_YAML);
    const head = await repo.commitAll("add orphan test");

    expect(await planJob(repo.path, "main", "HEAD")).toEqual({
      snapshot: { base, head },
      checked: [],
      warnings: [
        {
          code: "missing-transform",
          message: `a changed transform test covers transform ${TRANSFORM_ID}, which is not in the repo at ${head}`,
        },
      ],
    });
  });

  it("does not report uncommitted files when --head is not the checked-out commit", async () => {
    await repo.git("checkout", "-q", "-b", "feature");
    await repo.put(TRANSFORM_PATH, TRANSFORM_YAML);
    const head = await repo.commitAll("add transform");
    await repo.git("checkout", "-q", "main");
    const base = await repo.git("rev-parse", "HEAD");
    await repo.put("collections/transforms/draft.yaml", "draft\n");

    expect(await planJob(repo.path, "main", "feature")).toEqual({
      snapshot: { base, head },
      checked: [DAILY],
      warnings: [],
    });
  });

  it("refuses a --base that does not name a commit", async () => {
    const root = await repo.git("rev-parse", "--show-toplevel");
    const plan = planJob(repo.path, "no-such-branch", "HEAD");

    await expect(plan).rejects.toThrow(ConfigError);
    await expect(plan).rejects.toThrow(`--base no-such-branch is not a commit in ${root}`);
  });

  it("explains a --base that shares no history with --head", async () => {
    await repo.git("checkout", "-q", "--orphan", "unrelated");
    await repo.commitAll("unrelated root");
    const root = await repo.git("rev-parse", "--show-toplevel");
    const plan = planJob(repo.path, "main", "HEAD");

    await expect(plan).rejects.toThrow(ConfigError);
    await expect(plan).rejects.toThrow(`--base and --head share no history in ${root}`);
  });

  it("refuses a --repo that is not inside a git work tree", async () => {
    const outside = await mkdtemp(join(tmpdir(), "mb-ci-not-a-repo-"));
    try {
      const plan = planJob(outside, "main", "HEAD");

      await expect(plan).rejects.toThrow(ConfigError);
      await expect(plan).rejects.toThrow(`--repo ${outside} is not inside a git work tree`);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});

describe("planJob, reading a transform as Metabase imports it", () => {
  async function forkWithDaily(): Promise<string> {
    await repo.put(TRANSFORM_PATH, TRANSFORM_YAML);
    const base = await repo.commitAll("add transform");
    await repo.git("checkout", "-q", "-b", "feature");
    return base;
  }

  it("checks a transform whose identity sits under a YAML merge key", async () => {
    const base = await forkWithDaily();
    await repo.put(
      TRANSFORM_PATH,
      `<<: {name: Daily Order Summary, entity_id: ${TRANSFORM_ID}, serdes/meta: [{model: Transform}]}\n${BROKEN_QUERY}`,
    );
    const head = await repo.commitAll("move the identity under a merge key");

    expect(await planJob(repo.path, "main", "HEAD")).toEqual({
      snapshot: { base, head },
      checked: [DAILY],
      warnings: [],
    });
  });

  it("refuses a transform file replaced by a symlink", async () => {
    await forkWithDaily();
    await repo.put("notes/real.txt", TRANSFORM_YAML + BROKEN_QUERY);
    await repo.git("rm", "-q", TRANSFORM_PATH);
    await mkdir(join(repo.path, dirname(TRANSFORM_PATH)), { recursive: true });
    await symlink("../../notes/real.txt", join(repo.path, TRANSFORM_PATH));
    const head = await repo.commitAll("replace the transform with a symlink");
    const plan = planJob(repo.path, "main", "HEAD");

    await expect(plan).rejects.toThrow(ValidationError);
    await expect(plan).rejects.toThrow(
      `${head}:${TRANSFORM_PATH} is not a regular file (git mode 120000)`,
    );
  });

  it("refuses a file holding a character Metabase reads as a line break", async () => {
    await forkWithDaily();
    await repo.put(
      TRANSFORM_PATH,
      `name: Daily Order Summary\nentity_id: ${TRANSFORM_ID}\n#x\u2028serdes/meta: [{model: Transform}]\n`,
    );
    const head = await repo.commitAll("hide serdes/meta behind U+2028");
    const plan = planJob(repo.path, "main", "HEAD");

    await expect(plan).rejects.toThrow(ValidationError);
    await expect(plan).rejects.toThrow(
      `${head}:${TRANSFORM_PATH}: holds U+0085, U+2028 or U+2029, which Metabase reads as a line break`,
    );
  });

  it("refuses a changed content file that does not parse as invalid content, not a usage error", async () => {
    await repo.git("checkout", "-q", "-b", "feature");
    await repo.put("transforms/broken.yaml", "name: [unclosed\n");
    const head = await repo.commitAll("add a file that does not parse");
    const plan = planJob(repo.path, "main", "HEAD");

    await expect(plan).rejects.toThrow(ValidationError);
    await expect(plan).rejects.toThrow(`${head}:transforms/broken.yaml: invalid YAML: `);
  });

  it(
    "plans a diff of 1800 changed transforms",
    async () => {
      const ids = Array.from(
        { length: LARGE_DIFF_FILES },
        (_, index) => `t${String(index).padStart(5, "0")}${TRANSFORM_ID.slice(6)}`,
      );
      const write = (suffix: string) =>
        Promise.all(
          ids.map(async (id, index) => {
            const path = join(repo.path, "transforms", `t${index}.yaml`);
            await mkdir(dirname(path), { recursive: true });
            await writeFile(path, transformYaml(id, `T${index}${suffix}`), "utf8");
          }),
        );
      await write("");
      await repo.commitAll("add transforms");
      await repo.git("checkout", "-q", "-b", "feature");
      await write(" v2");
      await repo.commitAll("rename every transform");

      const plan = await planJob(repo.path, "main", "HEAD");

      expect(plan.checked.length).toBe(LARGE_DIFF_FILES);
    },
    LARGE_DIFF_TIMEOUT_MS,
  );
});

describe("planJob, reading only Metabase's content folders", () => {
  it("skips a changed YAML file outside Metabase's content folders that does not parse", async () => {
    const base = await repo.git("rev-parse", "HEAD");
    await repo.git("checkout", "-q", "-b", "feature");
    await repo.put(".github/workflows/ci.yml", "on: push\non: pull_request\n");
    const head = await repo.commitAll("add a workflow with a duplicate key");

    expect(await planJob(repo.path, "main", "HEAD")).toEqual({
      snapshot: { base, head },
      checked: [],
      warnings: [],
    });
  });

  it("does not list a transform-shaped file outside Metabase's content folders", async () => {
    const base = await repo.git("rev-parse", "HEAD");
    await repo.git("checkout", "-q", "-b", "feature");
    await repo.put("docs/examples/daily.yaml", transformYaml(TRANSFORM_ID, "Example"));
    const head = await repo.commitAll("add an example file");

    expect(await planJob(repo.path, "main", "HEAD")).toEqual({
      snapshot: { base, head },
      checked: [],
      warnings: [],
    });
  });
});

describe("planJob, reading the base side at the merge base", () => {
  it("reads a deleted test's base side at the merge base, not at --base", async () => {
    await repo.put("transforms/a.yaml", transformYaml(TRANSFORM_ID, "Alpha"));
    await repo.put("transforms/b.yaml", transformYaml(OTHER_TRANSFORM_ID, "Beta"));
    await repo.put("transforms/a/test.yaml", testYaml(TRANSFORM_ID));
    await repo.commitAll("fork point");
    await repo.git("checkout", "-q", "-b", "feature");
    await repo.git("rm", "-q", "transforms/a/test.yaml");
    const head = await repo.commitAll("delete the test of A");
    await repo.git("checkout", "-q", "main");
    await repo.put("transforms/a/test.yaml", testYaml(OTHER_TRANSFORM_ID));
    const base = await repo.commitAll("main points the test at B");
    await repo.git("checkout", "-q", "feature");

    expect(await planJob(repo.path, "main", "HEAD")).toEqual({
      snapshot: { base, head },
      checked: [{ entity_id: TRANSFORM_ID, name: "Alpha" }],
      warnings: [],
    });
  });

  it("checks a transform the branch changed although main deleted its file after the fork", async () => {
    await repo.put("transforms/a.yaml", transformYaml(TRANSFORM_ID, "Alpha"));
    await repo.commitAll("fork point");
    await repo.git("checkout", "-q", "-b", "feature");
    await repo.put("transforms/a.yaml", transformYaml(TRANSFORM_ID, "Alpha 2"));
    const head = await repo.commitAll("rename A");
    await repo.git("checkout", "-q", "main");
    await repo.git("rm", "-q", "transforms/a.yaml");
    const base = await repo.commitAll("main deletes A");
    await repo.git("checkout", "-q", "feature");

    expect(await planJob(repo.path, "main", "HEAD")).toEqual({
      snapshot: { base, head },
      checked: [{ entity_id: TRANSFORM_ID, name: "Alpha 2" }],
      warnings: [],
    });
  });

  it("does not check a transform whose test only main added after the fork", async () => {
    await repo.put("transforms/a.yaml", transformYaml(TRANSFORM_ID, "Alpha"));
    await repo.put("transforms/b.yaml", transformYaml(OTHER_TRANSFORM_ID, "Beta"));
    await repo.commitAll("fork point");
    await repo.git("checkout", "-q", "-b", "feature");
    await repo.put("transforms/a.yaml", transformYaml(TRANSFORM_ID, "Alpha 2"));
    const head = await repo.commitAll("change A");
    await repo.git("checkout", "-q", "main");
    await repo.put("transforms/b/test.yaml", testYaml(OTHER_TRANSFORM_ID));
    const base = await repo.commitAll("main adds a test of B");
    await repo.git("checkout", "-q", "feature");

    expect(await planJob(repo.path, "main", "HEAD")).toEqual({
      snapshot: { base, head },
      checked: [{ entity_id: TRANSFORM_ID, name: "Alpha 2" }],
      warnings: [],
    });
  });
});

describe("planJob, finding the transform of a changed test", () => {
  it("skips a file whose top-level entity_id is a different transform", async () => {
    await repo.put(
      "transforms/aa.yaml",
      `upstream_entity_id: ${TRANSFORM_ID}\n${transformYaml(OTHER_TRANSFORM_ID, "Beta")}`,
    );
    await repo.put("transforms/b.yaml", transformYaml(TRANSFORM_ID, "Alpha"));
    const base = await repo.commitAll("fork point");
    await repo.git("checkout", "-q", "-b", "feature");
    await repo.put("transforms/b/test.yaml", testYaml(TRANSFORM_ID));
    const head = await repo.commitAll("add test of A");

    expect(await planJob(repo.path, "main", "HEAD")).toEqual({
      snapshot: { base, head },
      checked: [{ entity_id: TRANSFORM_ID, name: "Alpha" }],
      warnings: [],
    });
  });

  it("skips a file that names the transform but is not one", async () => {
    await repo.put(
      "collections/card.yaml",
      `name: Card\nsource_entity_id: ${TRANSFORM_ID}\nserdes/meta:\n- model: Card\n`,
    );
    await repo.put("transforms/a.yaml", transformYaml(TRANSFORM_ID, "Alpha"));
    const base = await repo.commitAll("fork point");
    await repo.git("checkout", "-q", "-b", "feature");
    await repo.put("transforms/a/test.yaml", testYaml(TRANSFORM_ID));
    const head = await repo.commitAll("add test of A");

    expect(await planJob(repo.path, "main", "HEAD")).toEqual({
      snapshot: { base, head },
      checked: [{ entity_id: TRANSFORM_ID, name: "Alpha" }],
      warnings: [],
    });
  });

  it("checks the transform a renamed test covered before, and the one it covers now", async () => {
    const padding =
      "description: totals per day for the finance team\nmode: assert\nquery: select 1\n";
    await repo.put("transforms/a.yaml", transformYaml(TRANSFORM_ID, "Alpha"));
    await repo.put("transforms/b.yaml", transformYaml(OTHER_TRANSFORM_ID, "Beta"));
    await repo.put("transforms/tests/one.yaml", padding + testYaml(TRANSFORM_ID));
    const base = await repo.commitAll("fork point");
    await repo.git("checkout", "-q", "-b", "feature");
    await repo.git("mv", "transforms/tests/one.yaml", "transforms/tests/two.yaml");
    await repo.put("transforms/tests/two.yaml", padding + testYaml(OTHER_TRANSFORM_ID));
    const head = await repo.commitAll("rename the test and point it at B");

    expect(await repo.git("diff", "--name-status", "-M", "main", "HEAD")).toMatch(/^R\d+\t/);
    expect(await planJob(repo.path, "main", "HEAD")).toEqual({
      snapshot: { base, head },
      checked: [
        { entity_id: TRANSFORM_ID, name: "Alpha" },
        { entity_id: OTHER_TRANSFORM_ID, name: "Beta" },
      ],
      warnings: [],
    });
  });
});

describe("planJob, run from a subdirectory", () => {
  it("finds a change outside the --repo subdirectory when diff.relative is set", async () => {
    await repo.put("transforms/a.yaml", transformYaml(TRANSFORM_ID, "Alpha"));
    await repo.put("other/README.md", "elsewhere\n");
    const base = await repo.commitAll("fork point");
    await repo.git("checkout", "-q", "-b", "feature");
    await repo.put("transforms/a.yaml", transformYaml(TRANSFORM_ID, "Alpha 2"));
    const head = await repo.commitAll("change A");
    await repo.git("config", "diff.relative", "true");

    expect(await planJob(`${repo.path}/other`, "main", "HEAD")).toEqual({
      snapshot: { base, head },
      checked: [{ entity_id: TRANSFORM_ID, name: "Alpha 2" }],
      warnings: [],
    });
  });
});
