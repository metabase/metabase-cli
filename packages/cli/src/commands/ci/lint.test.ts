import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type CiEvent, type CiStage } from "../../core/ci-events";
import { type TempGitRepo, createTempGitRepo } from "../../runtime/temp-git-repo";
import { runJob } from "./job";
import { scopedLintStage } from "./lint";
import { withLintScope } from "./lint-scope";

const EDITED = "7JwIkkAG-06-nsl4jzsaq";
const UNRELATED = "bbbbbbbbbbbbbbbbbbbbb";
const COLLECTION = "ccccccccccccccccccccc";
const PARENT = "ddddddddddddddddddddd";
const NOT_INTERRUPTED = new AbortController().signal;

function transformYaml(name: string, entityId: string, collection: string | null): string {
  return [
    `name: ${name}`,
    `entity_id: ${entityId}`,
    "creator_id: admin@example.com",
    "source_database_id: Sample Database",
    ...(collection === null ? [] : [`collection_id: ${collection}`]),
    "source:",
    "  type: query",
    "  query:",
    '    "lib/type": mbql/query',
    "    database: Sample Database",
    "    stages:",
    '    - "lib/type": mbql.stage/native',
    "      native: SELECT 1 AS id",
    "target:",
    "  database: Sample Database",
    "  type: table",
    "  schema: PUBLIC",
    `  name: ${name}`,
    "serdes/meta:",
    "- model: Transform",
    "",
  ].join("\n");
}

function testYaml(entityId: string, transformId: string): string {
  return [
    "name: one row",
    `entity_id: ${entityId}`,
    `transform_id: ${transformId}`,
    "creator_id: admin@example.com",
    "inputs: []",
    "expectations:",
    "- type: empty",
    "  name: e",
    "  sql: SELECT id FROM PUBLIC.t WHERE id IS NULL",
    "serdes/meta:",
    "- model: TransformTest",
    "",
  ].join("\n");
}

function collectionYaml(name: string, entityId: string, parent: string | null): string {
  return [
    `name: ${name}`,
    `entity_id: ${entityId}`,
    ...(parent === null ? [] : [`parent_id: ${parent}`]),
    "namespace: transforms",
    "serdes/meta:",
    "- model: Collection",
    "",
  ].join("\n");
}

async function filesIn(folder: string): Promise<string[]> {
  const entries = await readdir(folder, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(folder, join(entry.parentPath, entry.name)))
    .toSorted();
}

let repo: TempGitRepo;

beforeEach(async () => {
  repo = await createTempGitRepo();
});

afterEach(async () => {
  await repo.remove();
});

async function lintEvents(base: string): Promise<CiEvent[]> {
  const events: CiEvent[] = [];
  await runJob({
    repo: repo.path,
    base,
    head: "HEAD",
    stages: async (plan): Promise<readonly CiStage[]> =>
      plan.checked.length === 0
        ? []
        : [
            scopedLintStage({
              repo: repo.path,
              head: plan.snapshot.head,
              checked: plan.checked,
              signal: NOT_INTERRUPTED,
            }),
          ],
    job: "job-1",
    now: () => new Date("2026-10-30T12:00:00.000Z"),
    write: (event) => events.push(event),
    resultsPath: null,
    signal: NOT_INTERRUPTED,
  });
  return events;
}

describe("withLintScope", () => {
  it("copies the transform, its tests, its collection chain and the shared files only", async () => {
    await repo.put("collections/edited.yaml", transformYaml("edited", EDITED, COLLECTION));
    await repo.put("collections/edited_test.yaml", testYaml("aRvM7DLesF1fOV4kRHidq", EDITED));
    await repo.put("collections/other.yaml", transformYaml("other", UNRELATED, null));
    await repo.put("collections/other_test.yaml", testYaml("eeeeeeeeeeeeeeeeeeeee", UNRELATED));
    await repo.put("collections/child.yaml", collectionYaml("Child", COLLECTION, PARENT));
    await repo.put("collections/parent.yaml", collectionYaml("Parent", PARENT, null));
    await repo.put(
      "collections/unused.yaml",
      collectionYaml("Unused", "fffffffffffffffffffff", null),
    );
    await repo.put(
      "databases/Sample Database/Sample Database.yaml",
      "name: Sample Database\nengine: postgres\nserdes/meta:\n- model: Database\n",
    );
    await repo.put(
      "databases/Sample Database/tables/orders/orders.yaml",
      "name: orders\nserdes/meta:\n- model: Database\n- model: Table\n",
    );
    await repo.put(
      "transforms/transform_tags/daily.yaml",
      "name: daily\nserdes/meta:\n- model: TransformTag\n",
    );
    await repo.put(".metabase-lint.json", "{}\n");
    const head = await repo.commitAll("content");

    const files = await withLintScope(
      {
        repo: repo.path,
        head,
        checked: [{ entity_id: EDITED, name: "edited" }],
        signal: NOT_INTERRUPTED,
      },
      filesIn,
    );

    expect(files).toEqual(
      [
        ".metabase-lint.json",
        "collections/child.yaml",
        "collections/edited.yaml",
        "collections/edited_test.yaml",
        "collections/parent.yaml",
        "databases/Sample Database/Sample Database.yaml",
        "transforms/transform_tags/daily.yaml",
      ].toSorted(),
    );
  });
});

describe("mb ci lint's stage", () => {
  it("fails on the edited transform and ignores a broken file it did not change", async () => {
    await repo.put(
      "collections/edited.yaml",
      [
        "name: edited",
        `entity_id: ${EDITED}`,
        "creator_id: admin@example.com",
        "source:",
        "  type: python",
        "  body: result = None",
        "  source-database: Sample Database",
        "  source-tables: {}",
        "target:",
        "  database: Sample Database",
        "  type: table",
        "  schema: PUBLIC",
        "  name: edited",
        "serdes/meta:",
        "- model: Transform",
        "",
      ].join("\n"),
    );
    await repo.put(
      "collections/unrelated_test.yaml",
      "name: broken\nentity_id: eeeeeeeeeeeeeeeeeeeee\ntransform_id: ggggggggggggggggggggg\ninputs: []\nserdes/meta:\n- model: TransformTest\n",
    );
    const base = await repo.commitAll("content");
    await repo.put(
      "collections/edited_test.yaml",
      `name: names a Python transform\nentity_id: aRvM7DLesF1fOV4kRHidq\ntransform_id: ${EDITED}\ncreator_id: admin@example.com\ninputs: []\nexpectations: []\nserdes/meta:\n- model: TransformTest\n`,
    );
    await repo.commitAll("add test");

    const events = await lintEvents(base);

    const failed = events.flatMap((event) =>
      event.type === "check.result" && event.verdict === "failed" ? [event.check.id] : [],
    );
    expect(failed).toEqual(["schema:collections/edited.yaml:1"]);
    expect(events.at(-1)).toMatchObject({ type: "job.end", state: "failed" });
  });

  it("runs no stage when the range changed no transform", async () => {
    await repo.put("collections/edited.yaml", transformYaml("edited", EDITED, null));
    const base = await repo.commitAll("content");
    await repo.put("README.md", "docs\n");
    await repo.commitAll("docs");

    const events = await lintEvents(base);

    expect(events.map((event) => event.type)).toEqual(["job.start", "job.end"]);
    expect(events.at(-1)).toMatchObject({ state: "passed" });
  });
});
