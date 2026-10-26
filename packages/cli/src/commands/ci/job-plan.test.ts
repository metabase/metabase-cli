import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ConfigError } from "@metabase/client/errors";

import { type TempGitRepo, createTempGitRepo } from "../../runtime/temp-git-repo";

import { planJob } from "./job-plan";

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

const TRANSFORM_YAML = transformYaml(TRANSFORM_ID, "Daily Order Summary");
const TEST_YAML = `entity_id: aRvM7DLesF1fOV4kRHidq\ntransform_id: ${TRANSFORM_ID}\nserdes/meta:\n- model: TransformTest\n`;
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
      coverage: NO_GAPS,
      checked: [],
      warnings: [
        {
          code: "uncommitted-content",
          message: `1 content file is not committed, so CI did not check: ${TRANSFORM_PATH}`,
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

    expect(await planJob(repo.path, "main", "HEAD")).toEqual({
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

    expect(await planJob(repo.path, "main", "HEAD")).toEqual({
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

    expect(await planJob(repo.path, "main", "HEAD")).toEqual({
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

    expect(await planJob(`${repo.path}/other`, "main", head)).toEqual({
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

    expect(await planJob(repo.path, "main", "HEAD")).toEqual({
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

    expect(await planJob(repo.path, "main", "feature")).toEqual({
      snapshot: { base, head },
      coverage: DAILY_UNTESTED_NEW,
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

  it("does not count a reformat of a transform's logic as an edit", async () => {
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

    expect(await planJob(repo.path, "main", "HEAD")).toEqual({
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

    expect(await planJob(repo.path, "main", "HEAD")).toEqual({
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

    expect(await planJob(repo.path, "main", "HEAD")).toEqual({
      snapshot: { base, head },
      checked: [DAILY],
      warnings: [],
      coverage: NO_GAPS,
    });
  });

  it("classifies a changed transform from its parsed YAML, whatever text the scan's pattern misses", async () => {
    const base = await repo.git("rev-parse", "HEAD");
    await repo.git("checkout", "-q", "-b", "feature");
    await repo.put(
      DAILY_PATH,
      `name: Daily Order Summary\nentity_id: ${TRANSFORM_ID}\nsource:\n  type: query\ntarget:\n  name: t\nserdes/meta:\n- model: !!str Transform\n`,
    );
    const head = await repo.commitAll("add transform with a tagged model");

    expect(await planJob(repo.path, "main", "HEAD")).toEqual({
      snapshot: { base, head },
      checked: [DAILY],
      warnings: [],
      coverage: DAILY_UNTESTED_NEW,
    });
  });
});
