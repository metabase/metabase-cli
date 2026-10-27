import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AbortError, ConfigError, ValidationError } from "@metabase/client/errors";

import { type TempGitRepo, createTempGitRepo } from "../../runtime/temp-git-repo";

import { planJob } from "./job-plan";

const NOT_INTERRUPTED = new AbortController().signal;
const TRANSFORM_ID = "7JwIkkAG-06-nsl4jzsaq";
const OTHER_TRANSFORM_ID = "7XqqzlsonSq4KFyOvtrAm";
const TRANSFORM_PATH = "collections/transforms/daily.yaml";
const DAILY_PATH = TRANSFORM_PATH;

function dailyYaml(source: string): string {
  return `name: Daily Order Summary\nentity_id: ${TRANSFORM_ID}\n${source}target:\n  name: t\nserdes/meta:\n- model: Transform\n`;
}
const TEST_PATH = "collections/transforms/daily/totals.yaml";

function transformYaml(entityId: string, name: string): string {
  return `name: ${name}\nentity_id: ${entityId}\nsource:\n  type: query\ntarget:\n  name: t\nserdes/meta:\n- model: Transform\n`;
}

function testYaml(transformId: string): string {
  return `entity_id: aRvM7DLesF1fOV4kRHidq\ntransform_id: ${transformId}\nserdes/meta:\n- model: TransformTest\n`;
}

const TRANSFORM_YAML = transformYaml(TRANSFORM_ID, "Daily Order Summary");
const TEST_YAML = testYaml(TRANSFORM_ID);
const DAILY = { entity_id: TRANSFORM_ID, name: "Daily Order Summary" };
const NO_GAPS = { untestedChanges: [], untouchedUntested: [] };
const DAILY_UNTESTED_NEW = {
  untestedChanges: [{ entityId: TRANSFORM_ID, name: "Daily Order Summary", change: "new" }],
  untouchedUntested: [],
};
const DAILY_UNTESTED_UNTOUCHED = {
  untestedChanges: [],
  untouchedUntested: [{ entityId: TRANSFORM_ID, name: "Daily Order Summary" }],
};
const BROKEN_QUERY = "source:\n  query: select broken(\n";
const NO_CONTENT_CHANGES = {
  code: "no-content-changes",
  message: "the change touches no Metabase content files, so no transform test ran",
};
const INTERRUPT_AFTER_MS = 300;
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

    expect(await planJob(repo.path, "main", "HEAD", NOT_INTERRUPTED)).toEqual({
      snapshot: { base, head: base },
      coverage: NO_GAPS,
      checked: [],
      warnings: [
        NO_CONTENT_CHANGES,
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

    expect(await planJob(repo.path, "main", "HEAD", NOT_INTERRUPTED)).toEqual({
      snapshot: { base, head },
      coverage: DAILY_UNTESTED_NEW,
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

    expect(await planJob(repo.path, "main", "HEAD", NOT_INTERRUPTED)).toEqual({
      snapshot: { base, head },
      coverage: NO_GAPS,
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

    expect(await planJob(repo.path, "main", "HEAD", NOT_INTERRUPTED)).toEqual({
      snapshot: { base, head },
      coverage: DAILY_UNTESTED_NEW,
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

    expect(await planJob(repo.path, "main", "HEAD", NOT_INTERRUPTED)).toEqual({
      snapshot: { base, head },
      coverage: DAILY_UNTESTED_UNTOUCHED,
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

    expect(await planJob(`${repo.path}/other`, "main", head, NOT_INTERRUPTED)).toEqual({
      snapshot: { base, head },
      coverage: NO_GAPS,
      checked: [DAILY],
      warnings: [],
    });
  });

  it("warns about a changed test whose transform is not in the repo", async () => {
    const base = await repo.git("rev-parse", "HEAD");
    await repo.git("checkout", "-q", "-b", "feature");
    await repo.put(TEST_PATH, TEST_YAML);
    const head = await repo.commitAll("add orphan test");

    expect(await planJob(repo.path, "main", "HEAD", NOT_INTERRUPTED)).toEqual({
      snapshot: { base, head },
      coverage: NO_GAPS,
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

    expect(await planJob(repo.path, "main", "feature", NOT_INTERRUPTED)).toEqual({
      snapshot: { base, head },
      coverage: DAILY_UNTESTED_NEW,
      checked: [DAILY],
      warnings: [],
    });
  });

  it("refuses a --base that does not name a commit", async () => {
    const root = await repo.git("rev-parse", "--show-toplevel");
    const plan = planJob(repo.path, "no-such-branch", "HEAD", NOT_INTERRUPTED);

    await expect(plan).rejects.toThrow(ConfigError);
    await expect(plan).rejects.toThrow(`--base no-such-branch is not a commit in ${root}`);
  });

  it("explains a --base that shares no history with --head", async () => {
    await repo.git("checkout", "-q", "--orphan", "unrelated");
    await repo.commitAll("unrelated root");
    const root = await repo.git("rev-parse", "--show-toplevel");
    const plan = planJob(repo.path, "main", "HEAD", NOT_INTERRUPTED);

    await expect(plan).rejects.toThrow(ConfigError);
    await expect(plan).rejects.toThrow(`--base and --head share no history in ${root}`);
  });

  it("refuses a --repo that is not inside a git work tree", async () => {
    const outside = await mkdtemp(join(tmpdir(), "mb-ci-not-a-repo-"));
    try {
      const plan = planJob(outside, "main", "HEAD", NOT_INTERRUPTED);

      await expect(plan).rejects.toThrow(ConfigError);
      await expect(plan).rejects.toThrow(`--repo ${outside} is not inside a git work tree`);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("does not count a YAML layout change of a transform's logic as an edit", async () => {
    await repo.put(
      DAILY_PATH,
      dailyYaml("source:\n  type: query\n  query:\n    native: SELECT 1\n    database: 1\n"),
    );
    const base = await repo.commitAll("add transform");
    await repo.git("checkout", "-q", "-b", "feature");
    await repo.put(
      DAILY_PATH,
      dailyYaml("source: {query: {database: 1, native: 'SELECT 1'}, type: query}\n"),
    );
    const head = await repo.commitAll("reformat");

    expect(await planJob(repo.path, "main", "HEAD", NOT_INTERRUPTED)).toEqual({
      snapshot: { base, head },
      checked: [DAILY],
      warnings: [],
      coverage: DAILY_UNTESTED_UNTOUCHED,
    });
  });

  it("counts a change to a transform's query as an edit that needs a test", async () => {
    await repo.put(DAILY_PATH, dailyYaml("source:\n  type: query\n  query: SELECT 1\n"));
    const base = await repo.commitAll("add transform");
    await repo.git("checkout", "-q", "-b", "feature");
    await repo.put(DAILY_PATH, dailyYaml("source:\n  type: query\n  query: SELECT 2\n"));
    const head = await repo.commitAll("edit query");

    expect(await planJob(repo.path, "main", "HEAD", NOT_INTERRUPTED)).toEqual({
      snapshot: { base, head },
      checked: [DAILY],
      warnings: [],
      coverage: {
        untestedChanges: [
          { entityId: TRANSFORM_ID, name: "Daily Order Summary", change: "edited" },
        ],
        untouchedUntested: [],
      },
    });
  });

  it("finds a test the change left alone even when its key and model are quoted", async () => {
    await repo.put(DAILY_PATH, dailyYaml("source:\n  type: query\n  query: SELECT 1\n"));
    await repo.put(
      TEST_PATH,
      `{"entity_id": "aRvM7DLesF1fOV4kRHidq", "transform_id": "${TRANSFORM_ID}", "serdes/meta": [{"model": "TransformTest"}]}\n`,
    );
    const base = await repo.commitAll("add transform and quoted test");
    await repo.git("checkout", "-q", "-b", "feature");
    await repo.put(DAILY_PATH, dailyYaml("source:\n  type: query\n  query: SELECT 2\n"));
    const head = await repo.commitAll("edit query");

    expect(await planJob(repo.path, "main", "HEAD", NOT_INTERRUPTED)).toEqual({
      snapshot: { base, head },
      checked: [DAILY],
      warnings: [],
      coverage: NO_GAPS,
    });
  });

  it("classifies a changed transform whose model carries a tag from its parsed YAML", async () => {
    const base = await repo.git("rev-parse", "HEAD");
    await repo.git("checkout", "-q", "-b", "feature");
    await repo.put(
      DAILY_PATH,
      `name: Daily Order Summary\nentity_id: ${TRANSFORM_ID}\nsource:\n  type: query\ntarget:\n  name: t\nserdes/meta:\n- model: !!str Transform\n`,
    );
    const head = await repo.commitAll("add transform with a tagged model");

    expect(await planJob(repo.path, "main", "HEAD", NOT_INTERRUPTED)).toEqual({
      snapshot: { base, head },
      checked: [DAILY],
      warnings: [],
      coverage: DAILY_UNTESTED_NEW,
    });
  });
});

describe("planJob, on a change that touches no content file", () => {
  it("warns that it checked nothing when --head is on the base branch itself", async () => {
    await repo.put("notes.md", "a note\n");
    const head = await repo.commitAll("commit on main");

    expect(await planJob(repo.path, "main", "HEAD", NOT_INTERRUPTED)).toEqual({
      snapshot: { base: head, head },
      checked: [],
      warnings: [NO_CONTENT_CHANGES],
      coverage: NO_GAPS,
    });
  });

  it("warns that it checked nothing when the branch reverted its own content change", async () => {
    const base = await repo.git("rev-parse", "HEAD");
    await repo.git("checkout", "-q", "-b", "feature");
    await repo.put(TRANSFORM_PATH, TRANSFORM_YAML);
    await repo.commitAll("add transform");
    await repo.git("revert", "--no-edit", "HEAD");
    const head = await repo.git("rev-parse", "HEAD");

    expect(await planJob(repo.path, "main", "HEAD", NOT_INTERRUPTED)).toEqual({
      snapshot: { base, head },
      checked: [],
      warnings: [NO_CONTENT_CHANGES],
      coverage: NO_GAPS,
    });
  });
});

describe("planJob, interrupted", () => {
  it("stops a git call that is still running and names it", async () => {
    await repo.put("hang.sh", "#!/bin/sh\nsleep 30\n");
    await chmod(join(repo.path, "hang.sh"), 0o755);
    await repo.git("config", "core.fsmonitor", join(repo.path, "hang.sh"));
    const controller = new AbortController();
    const plan = planJob(repo.path, "main", "HEAD", controller.signal);
    setTimeout(() => controller.abort(), INTERRUPT_AFTER_MS);

    await expect(plan).rejects.toThrow(AbortError);
    await expect(plan).rejects.toThrow(
      "interrupted while git status --porcelain -z --untracked-files=all ran in",
    );
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
      `<<: {name: Daily Order Summary, entity_id: ${TRANSFORM_ID}, target: {name: t}, serdes/meta: [{model: Transform}]}\n${BROKEN_QUERY}`,
    );
    const head = await repo.commitAll("move the identity under a merge key");

    expect(await planJob(repo.path, "main", "HEAD", NOT_INTERRUPTED)).toEqual({
      snapshot: { base, head },
      checked: [DAILY],
      warnings: [],
      coverage: {
        untestedChanges: [
          { entityId: TRANSFORM_ID, name: "Daily Order Summary", change: "edited" },
        ],
        untouchedUntested: [],
      },
    });
  });

  it("finds an unchanged test whose identity sits under a YAML merge key", async () => {
    await repo.put(DAILY_PATH, dailyYaml("source:\n  type: query\n  query: SELECT 1\n"));
    await repo.put(
      TEST_PATH,
      `<<: {entity_id: aRvM7DLesF1fOV4kRHidq, transform_id: ${TRANSFORM_ID}, serdes/meta: [{model: TransformTest}]}\n`,
    );
    const base = await repo.commitAll("add transform and its test");
    await repo.git("checkout", "-q", "-b", "feature");
    await repo.put(DAILY_PATH, dailyYaml("source:\n  type: query\n  query: SELECT 2\n"));
    const head = await repo.commitAll("edit query");

    expect(await planJob(repo.path, "main", "HEAD", NOT_INTERRUPTED)).toEqual({
      snapshot: { base, head },
      checked: [DAILY],
      warnings: [],
      coverage: NO_GAPS,
    });
  });

  it("refuses a transform file replaced by a symlink", async () => {
    await forkWithDaily();
    await repo.put("notes/real.txt", TRANSFORM_YAML + BROKEN_QUERY);
    await repo.git("rm", "-q", TRANSFORM_PATH);
    await mkdir(join(repo.path, dirname(TRANSFORM_PATH)), { recursive: true });
    await symlink("../../notes/real.txt", join(repo.path, TRANSFORM_PATH));
    const head = await repo.commitAll("replace the transform with a symlink");
    const plan = planJob(repo.path, "main", "HEAD", NOT_INTERRUPTED);

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
    const plan = planJob(repo.path, "main", "HEAD", NOT_INTERRUPTED);

    await expect(plan).rejects.toThrow(ValidationError);
    await expect(plan).rejects.toThrow(
      `${head}:${TRANSFORM_PATH}: holds U+0085, U+2028 or U+2029, which Metabase reads as a line break`,
    );
  });

  it("refuses a changed content file that does not parse as invalid content, not a usage error", async () => {
    await repo.git("checkout", "-q", "-b", "feature");
    await repo.put("transforms/broken.yaml", "name: [unclosed\n");
    const head = await repo.commitAll("add a file that does not parse");
    const plan = planJob(repo.path, "main", "HEAD", NOT_INTERRUPTED);

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

      const plan = await planJob(repo.path, "main", "HEAD", NOT_INTERRUPTED);

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

    expect(await planJob(repo.path, "main", "HEAD", NOT_INTERRUPTED)).toEqual({
      snapshot: { base, head },
      checked: [],
      warnings: [NO_CONTENT_CHANGES],
      coverage: NO_GAPS,
    });
  });

  it("does not list a transform-shaped file outside Metabase's content folders", async () => {
    const base = await repo.git("rev-parse", "HEAD");
    await repo.git("checkout", "-q", "-b", "feature");
    await repo.put("docs/examples/daily.yaml", transformYaml(TRANSFORM_ID, "Example"));
    const head = await repo.commitAll("add an example file");

    expect(await planJob(repo.path, "main", "HEAD", NOT_INTERRUPTED)).toEqual({
      snapshot: { base, head },
      checked: [],
      warnings: [NO_CONTENT_CHANGES],
      coverage: NO_GAPS,
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

    expect(await planJob(repo.path, "main", "HEAD", NOT_INTERRUPTED)).toEqual({
      snapshot: { base, head },
      checked: [{ entity_id: TRANSFORM_ID, name: "Alpha" }],
      warnings: [],
      coverage: {
        untestedChanges: [{ entityId: TRANSFORM_ID, name: "Alpha", change: "lost-test" }],
        untouchedUntested: [{ entityId: OTHER_TRANSFORM_ID, name: "Beta" }],
      },
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

    expect(await planJob(repo.path, "main", "HEAD", NOT_INTERRUPTED)).toEqual({
      snapshot: { base, head },
      checked: [{ entity_id: TRANSFORM_ID, name: "Alpha 2" }],
      warnings: [],
      coverage: {
        untestedChanges: [],
        untouchedUntested: [{ entityId: TRANSFORM_ID, name: "Alpha 2" }],
      },
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

    expect(await planJob(repo.path, "main", "HEAD", NOT_INTERRUPTED)).toEqual({
      snapshot: { base, head },
      checked: [{ entity_id: TRANSFORM_ID, name: "Alpha 2" }],
      warnings: [],
      coverage: {
        untestedChanges: [],
        untouchedUntested: [
          { entityId: TRANSFORM_ID, name: "Alpha 2" },
          { entityId: OTHER_TRANSFORM_ID, name: "Beta" },
        ],
      },
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

    expect(await planJob(repo.path, "main", "HEAD", NOT_INTERRUPTED)).toEqual({
      snapshot: { base, head },
      checked: [{ entity_id: TRANSFORM_ID, name: "Alpha" }],
      warnings: [],
      coverage: {
        untestedChanges: [],
        untouchedUntested: [{ entityId: OTHER_TRANSFORM_ID, name: "Beta" }],
      },
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

    expect(await planJob(repo.path, "main", "HEAD", NOT_INTERRUPTED)).toEqual({
      snapshot: { base, head },
      checked: [{ entity_id: TRANSFORM_ID, name: "Alpha" }],
      warnings: [],
      coverage: NO_GAPS,
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
    expect(await planJob(repo.path, "main", "HEAD", NOT_INTERRUPTED)).toEqual({
      snapshot: { base, head },
      checked: [
        { entity_id: TRANSFORM_ID, name: "Alpha" },
        { entity_id: OTHER_TRANSFORM_ID, name: "Beta" },
      ],
      warnings: [],
      coverage: {
        untestedChanges: [{ entityId: TRANSFORM_ID, name: "Alpha", change: "lost-test" }],
        untouchedUntested: [],
      },
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

    expect(await planJob(`${repo.path}/other`, "main", "HEAD", NOT_INTERRUPTED)).toEqual({
      snapshot: { base, head },
      checked: [{ entity_id: TRANSFORM_ID, name: "Alpha 2" }],
      warnings: [],
      coverage: {
        untestedChanges: [],
        untouchedUntested: [{ entityId: TRANSFORM_ID, name: "Alpha 2" }],
      },
    });
  });
});

const LEGACY_ID = "LegacyLegacyLegacy001";
const LEGACY_PATH = "transforms/legacy.yaml";
const LEGACY = { entityId: LEGACY_ID, name: "Legacy" };

async function branchThatTouchesOnlyAReadme(): Promise<string> {
  await repo.git("checkout", "-q", "-b", "feature");
  await repo.put("README.md", "changed\n");
  return repo.commitAll("touch no content file");
}

describe("planJob, an unchanged file at head that does not read", () => {
  it("plans a branch that touches no content file, counting an unchanged transform", async () => {
    await repo.put(LEGACY_PATH, transformYaml(LEGACY_ID, "Legacy"));
    const base = await repo.commitAll("a transform on main");
    const head = await branchThatTouchesOnlyAReadme();

    expect(await planJob(repo.path, "main", "HEAD", NOT_INTERRUPTED)).toEqual({
      snapshot: { base, head },
      checked: [],
      warnings: [NO_CONTENT_CHANGES],
      coverage: { untestedChanges: [], untouchedUntested: [LEGACY] },
    });
  });

  it("warns about an unchanged transform that repeats a key, rather than stopping the job", async () => {
    await repo.put(
      LEGACY_PATH,
      `description: one\n${transformYaml(LEGACY_ID, "Legacy")}description: two\n`,
    );
    const base = await repo.commitAll("a transform with a repeated key on main");
    const head = await branchThatTouchesOnlyAReadme();

    expect(await planJob(repo.path, "main", "HEAD", NOT_INTERRUPTED)).toEqual({
      snapshot: { base, head },
      checked: [],
      warnings: [
        NO_CONTENT_CHANGES,
        {
          code: "unread-content",
          message: `1 content file this change did not touch could not be read, so the coverage check skipped it: ${head}:${LEGACY_PATH}: invalid YAML: Map keys must be unique at line 10, column 1:\n\n- model: Transform\ndescription: two\n^\n`,
        },
      ],
      coverage: NO_GAPS,
    });
  });

  it("warns about an unchanged transform that has no target, rather than stopping the job", async () => {
    await repo.put(
      LEGACY_PATH,
      `name: Legacy\nentity_id: ${LEGACY_ID}\nsource:\n  type: query\nserdes/meta:\n- model: Transform\n`,
    );
    const base = await repo.commitAll("a transform without a target on main");
    const head = await branchThatTouchesOnlyAReadme();

    expect(await planJob(repo.path, "main", "HEAD", NOT_INTERRUPTED)).toEqual({
      snapshot: { base, head },
      checked: [],
      warnings: [
        NO_CONTENT_CHANGES,
        {
          code: "unread-content",
          message: `1 content file this change did not touch could not be read, so the coverage check skipped it: ${LEGACY_PATH}: a Transform must have an entity_id, a name, a source and a target`,
        },
      ],
      coverage: NO_GAPS,
    });
  });

  it("warns about an unchanged file whose path holds a newline, rather than stopping the job", async () => {
    await repo.put("transforms/a\nb.yaml", transformYaml(LEGACY_ID, "Legacy"));
    const base = await repo.commitAll("a transform at a path with a newline on main");
    const head = await branchThatTouchesOnlyAReadme();

    expect(await planJob(repo.path, "main", "HEAD", NOT_INTERRUPTED)).toEqual({
      snapshot: { base, head },
      checked: [],
      warnings: [
        NO_CONTENT_CHANGES,
        {
          code: "unread-content",
          message: `1 content file this change did not touch could not be read, so the coverage check skipped it: ${head}:"transforms/a\\nb.yaml": a path with a newline cannot be read; rename the file`,
        },
      ],
      coverage: NO_GAPS,
    });
  });

  it("checks a transform the branch gives the source that main's copy lacks, as new", async () => {
    await repo.put(
      LEGACY_PATH,
      `name: Legacy\nentity_id: ${LEGACY_ID}\ntarget:\n  name: t\nserdes/meta:\n- model: Transform\n`,
    );
    const base = await repo.commitAll("a transform without a source on main");
    await repo.git("checkout", "-q", "-b", "feature");
    await repo.put(LEGACY_PATH, transformYaml(LEGACY_ID, "Legacy"));
    const head = await repo.commitAll("add the source");

    expect(await planJob(repo.path, "main", "HEAD", NOT_INTERRUPTED)).toEqual({
      snapshot: { base, head },
      checked: [{ entity_id: LEGACY_ID, name: "Legacy" }],
      warnings: [],
      coverage: { untestedChanges: [{ ...LEGACY, change: "new" }], untouchedUntested: [] },
    });
  });

  it("refuses a changed transform that has no source", async () => {
    await repo.git("checkout", "-q", "-b", "feature");
    await repo.put(
      DAILY_PATH,
      `name: Daily\nentity_id: ${TRANSFORM_ID}\ntarget:\n  name: t\nserdes/meta:\n- model: Transform\n`,
    );
    await repo.commitAll("add a transform with no source");

    const plan = planJob(repo.path, "main", "HEAD", NOT_INTERRUPTED);

    await expect(plan).rejects.toThrow(ValidationError);
    await expect(plan).rejects.toThrow(
      `${DAILY_PATH}: a Transform must have an entity_id, a name, a source and a target`,
    );
  });
});

function testWithModel(model: string): string {
  return `entity_id: aRvM7DLesF1fOV4kRHidq\ntransform_id: ${TRANSFORM_ID}\nserdes/meta:\n- ${model}\n`;
}

describe("planJob, finding a transform or test however its model entry is written", () => {
  async function checkedForNewTestOf(model: string) {
    await repo.put(
      DAILY_PATH,
      `name: Daily Order Summary\nentity_id: ${TRANSFORM_ID}\nsource:\n  type: query\ntarget:\n  name: t\nserdes/meta:\n- model${model}\n`,
    );
    await repo.commitAll("a transform on main");
    await repo.git("checkout", "-q", "-b", "feature");
    await repo.put(TEST_PATH, TEST_YAML);
    await repo.commitAll("add a test");
    return (await planJob(repo.path, "main", "HEAD", NOT_INTERRUPTED)).checked;
  }

  async function coverageOfEditWithUnchangedTest(testText: string) {
    await repo.put(DAILY_PATH, dailyYaml("source:\n  type: query\n  query: SELECT 1\n"));
    await repo.put(TEST_PATH, testText);
    await repo.commitAll("a tested transform on main");
    await repo.git("checkout", "-q", "-b", "feature");
    await repo.put(DAILY_PATH, dailyYaml("source:\n  type: query\n  query: SELECT 2\n"));
    await repo.commitAll("edit the query");
    return (await planJob(repo.path, "main", "HEAD", NOT_INTERRUPTED)).coverage;
  }

  it("checks the transform of a new test when the transform writes its model plainly", async () => {
    expect(await checkedForNewTestOf(": Transform")).toEqual([DAILY]);
  });

  it("checks the transform of a new test when the transform tags its model as a string", async () => {
    expect(await checkedForNewTestOf(": !!str Transform")).toEqual([DAILY]);
  });

  it("checks the transform of a new test when the transform puts its model on the next line", async () => {
    expect(await checkedForNewTestOf(":\n    Transform")).toEqual([DAILY]);
  });

  it("finds an unchanged test whose model has a space before the colon", async () => {
    expect(await coverageOfEditWithUnchangedTest(testWithModel("model : TransformTest"))).toEqual(
      NO_GAPS,
    );
  });

  it("finds an unchanged test that tags its model as a string", async () => {
    expect(
      await coverageOfEditWithUnchangedTest(testWithModel("model: !!str TransformTest")),
    ).toEqual(NO_GAPS);
  });

  it("finds an unchanged test whose model has more than one space after the colon", async () => {
    expect(
      await coverageOfEditWithUnchangedTest(
        `{"entity_id": "aRvM7DLesF1fOV4kRHidq", "transform_id": "${TRANSFORM_ID}", "serdes/meta": [{"model":   "TransformTest"}]}\n`,
      ),
    ).toEqual(NO_GAPS);
  });

  it("finds an unchanged test whose model key and value are single-quoted", async () => {
    expect(
      await coverageOfEditWithUnchangedTest(testWithModel("'model': 'TransformTest'")),
    ).toEqual(NO_GAPS);
  });
});

function filter(value: string): string {
  return `source:\n  type: query\n  query:\n    filter: ${value}\n`;
}

describe("planJob, an edit as Metabase's YAML 1.1 reader sees it", () => {
  async function untestedAfterFilterChange(before: string, after: string) {
    await repo.put(DAILY_PATH, dailyYaml(filter(before)));
    await repo.commitAll("an untested transform on main");
    await repo.git("checkout", "-q", "-b", "feature");
    await repo.put(DAILY_PATH, dailyYaml(filter(after)));
    await repo.commitAll("change the filter value");
    return (await planJob(repo.path, "main", "HEAD", NOT_INTERRUPTED)).coverage.untestedChanges;
  }

  const DAILY_EDITED = [{ entityId: TRANSFORM_ID, name: "Daily Order Summary", change: "edited" }];

  it("counts a changed filter value as an edit", async () => {
    expect(await untestedAfterFilterChange("15", "16")).toEqual(DAILY_EDITED);
  });

  it("counts unquoting 'on', which Metabase then reads as true, as an edit", async () => {
    expect(await untestedAfterFilterChange("'on'", "on")).toEqual(DAILY_EDITED);
  });

  it("counts 017 changed to 17, which Metabase reads as 15 changed to 17, as an edit", async () => {
    expect(await untestedAfterFilterChange("017", "17")).toEqual(DAILY_EDITED);
  });

  it("does not count quoting a plain word, which both readers read the same, as an edit", async () => {
    expect(await untestedAfterFilterChange("active", "'active'")).toEqual([]);
  });
});

function withTarget(name: string): string {
  return `name: Daily Order Summary\nentity_id: ${TRANSFORM_ID}\nsource:\n  type: query\ntarget:\n  name: ${name}\nserdes/meta:\n- model: Transform\n`;
}

describe("planJob, what counts as an edit", () => {
  it("counts a change to a transform's target as an edit that needs a test", async () => {
    await repo.put(DAILY_PATH, withTarget("daily_totals"));
    await repo.commitAll("add transform");
    await repo.git("checkout", "-q", "-b", "feature");
    await repo.put(DAILY_PATH, withTarget("daily_totals_v2"));
    await repo.commitAll("retarget");

    expect((await planJob(repo.path, "main", "HEAD", NOT_INTERRUPTED)).coverage).toEqual({
      untestedChanges: [{ entityId: TRANSFORM_ID, name: "Daily Order Summary", change: "edited" }],
      untouchedUntested: [],
    });
  });
});

describe("planJob, a change that removes a transform's tests", () => {
  const SECOND_TEST_PATH = "collections/transforms/daily/second.yaml";

  async function onMainWithTests(...testPaths: string[]): Promise<void> {
    await repo.put(DAILY_PATH, dailyYaml("source:\n  type: query\n  query: SELECT 1\n"));
    for (const path of testPaths) {
      await repo.put(path, TEST_YAML);
    }
    await repo.commitAll("a tested transform on main");
    await repo.git("checkout", "-q", "-b", "feature");
  }

  async function coverage() {
    return (await planJob(repo.path, "main", "HEAD", NOT_INTERRUPTED)).coverage;
  }

  it("fails a transform whose last test the change deletes", async () => {
    await onMainWithTests(TEST_PATH);
    await repo.git("rm", "-q", TEST_PATH);
    await repo.commitAll("delete the test");

    expect(await coverage()).toEqual({
      untestedChanges: [
        { entityId: TRANSFORM_ID, name: "Daily Order Summary", change: "lost-test" },
      ],
      untouchedUntested: [],
    });
  });

  it("reports a transform that is edited and loses its last test once, as losing its test", async () => {
    await onMainWithTests(TEST_PATH);
    await repo.git("rm", "-q", TEST_PATH);
    await repo.put(DAILY_PATH, dailyYaml("source:\n  type: query\n  query: SELECT 2\n"));
    await repo.commitAll("edit the query and delete the test");

    expect(await coverage()).toEqual({
      untestedChanges: [
        { entityId: TRANSFORM_ID, name: "Daily Order Summary", change: "lost-test" },
      ],
      untouchedUntested: [],
    });
  });

  it("passes a transform that keeps one of its two tests", async () => {
    await onMainWithTests(TEST_PATH, SECOND_TEST_PATH);
    await repo.git("rm", "-q", TEST_PATH);
    await repo.commitAll("delete one test");

    expect(await coverage()).toEqual(NO_GAPS);
  });

  it("passes a change that deletes a transform together with its tests", async () => {
    await onMainWithTests(TEST_PATH);
    await repo.git("rm", "-q", DAILY_PATH, TEST_PATH);
    await repo.commitAll("delete the transform and its test");

    expect(await coverage()).toEqual(NO_GAPS);
  });

  it("passes a change that moves a transform's test to another file", async () => {
    await onMainWithTests(TEST_PATH);
    await repo.git("mv", TEST_PATH, SECOND_TEST_PATH);
    await repo.commitAll("move the test");

    expect(await coverage()).toEqual(NO_GAPS);
  });
});

describe("planJob, whitespace in a transform's query", () => {
  it("counts a whitespace-only change inside the query text as an edit that needs a test", async () => {
    await repo.put(DAILY_PATH, dailyYaml("source:\n  type: query\n  query: SELECT 1\n"));
    await repo.commitAll("an untested transform on main");
    await repo.git("checkout", "-q", "-b", "feature");
    await repo.put(DAILY_PATH, dailyYaml("source:\n  type: query\n  query: SELECT  1\n"));
    await repo.commitAll("add a space inside the query");

    expect((await planJob(repo.path, "main", "HEAD", NOT_INTERRUPTED)).coverage).toEqual({
      untestedChanges: [{ entityId: TRANSFORM_ID, name: "Daily Order Summary", change: "edited" }],
      untouchedUntested: [],
    });
  });
});
