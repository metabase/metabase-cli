import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { DiffFile } from "../../contracts/changes";
import { FIXTURE_CREDENTIALS, openCliFixture, recorded, type CliFixture } from "../cli/cli-fixture";
import { Git, gitText } from "../git/service";
import { runCommand, startProcess } from "../process/spawn";

import { readSessionContent } from "./content";

const NEVER_ABORTED = new AbortController().signal;
const METABASE_URL = "http://metabase.test";
const TRANSFORM_PATH = "collections/transforms/orders_by_status.yaml";
const DASHBOARD_PATH = "collections/main/orders_overview.yaml";
const SEGMENT_PATH = "databases/warehouse/schemas/public/tables/orders/segments/big_orders.yaml";
const OLD_SEGMENT_PATH = "databases/warehouse/schemas/public/tables/orders/segments/old.yaml";
const CI_PATH = ".github/workflows/ci.yaml";

const GIT_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_AUTHOR_NAME: "RDE Test",
  GIT_AUTHOR_EMAIL: "rde-test@example.com",
  GIT_COMMITTER_NAME: "RDE Test",
  GIT_COMMITTER_EMAIL: "rde-test@example.com",
};

// The files the `metabase-panel` scenario writes, with the slot's seeded entity ids, so the recorded
// `validate`, `eid` and `transform get` answers are the ones the CLI gave for them.
const TRANSFORM_YAML = `name: e2e_orders_by_status
entity_id: ecbq8CvqCzxCnki9fvAhP
serdes/meta:
- id: ecbq8CvqCzxCnki9fvAhP
  model: Transform
`;

const DASHBOARD_YAML = `name: Orders Overview
entity_id: w7JTwLIv1mf22BiDDBDEP
serdes/meta:
- id: w7JTwLIv1mf22BiDDBDEP
  model: Dashboard
`;

const SEGMENT_YAML = `name: Big orders
entity_id: bIgOrDeRsSeGmEnT00001
serdes/meta:
- id: bIgOrDeRsSeGmEnT00001
  model: Segment
`;

const OLD_SEGMENT_YAML = `name: Old orders
entity_id: oLdOrDeRsSeGmEnT00001
serdes/meta:
- id: oLdOrDeRsSeGmEnT00001
  model: Segment
`;

const git = new Git({ env: GIT_ENV, run: runCommand, start: startProcess, signal: NEVER_ABORTED });

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) {
    await cleanup();
  }
});

async function write(root: string, path: string, text: string): Promise<void> {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), text, "utf8");
}

function changed(path: string, change: DiffFile["change"]): DiffFile {
  return { path, previousPath: null, change, added: 1, removed: 0, binary: false };
}

interface Checkout {
  readonly cwd: string;
  readonly from: string;
  readonly cli: CliFixture;
}

async function checkout(): Promise<Checkout> {
  const cwd = await mkdtemp(join(tmpdir(), "rde-content-"));
  cleanups.push(() => rm(cwd, { recursive: true, force: true }));
  await git.write(cwd, ["init", "--quiet", "--initial-branch=main"]);
  await write(cwd, OLD_SEGMENT_PATH, OLD_SEGMENT_YAML);
  await git.write(cwd, ["add", "."]);
  await git.write(cwd, ["commit", "--quiet", "-m", "seed"]);
  const from = gitText(await git.read(cwd, ["rev-parse", "HEAD"])).trim();
  await rm(join(cwd, OLD_SEGMENT_PATH));
  await write(cwd, TRANSFORM_PATH, TRANSFORM_YAML);
  await write(cwd, DASHBOARD_PATH, DASHBOARD_YAML);
  await write(cwd, SEGMENT_PATH, SEGMENT_YAML);
  await write(cwd, CI_PATH, "jobs: {}\n");
  const cli = await openCliFixture(FIXTURE_CREDENTIALS);
  cleanups.push(() => cli.close());
  await cli.answer(`validate ${TRANSFORM_PATH}`, {
    stdout: await recorded("validate.segment-without-definition.stdout"),
    stderr: await recorded("validate.segment-without-definition.stderr"),
    exit: 1,
  });
  await cli.answer("eid --body", {
    stdout: await recorded("eid.seeded.stdout"),
    stderr: "",
    exit: 0,
  });
  await cli.answer("transform get", {
    stdout: await recorded("transform-get.last-run.stdout"),
    stderr: "",
    exit: 0,
  });
  return { cwd, from, cli };
}

const CHANGED_FILES: readonly DiffFile[] = [
  changed(CI_PATH, "added"),
  changed(TRANSFORM_PATH, "added"),
  changed(DASHBOARD_PATH, "modified"),
  changed(SEGMENT_PATH, "added"),
  changed(OLD_SEGMENT_PATH, "deleted"),
];

describe("readSessionContent", () => {
  it("lists the changed content as objects, with their validation, their pages and a transform's last run", async () => {
    const repo = await checkout();

    const content = await readSessionContent(
      { git, cli: repo.cli.cli, log: () => undefined },
      {
        cwd: repo.cwd,
        changed: { from: repo.from, files: CHANGED_FILES },
        site: { url: METABASE_URL, worktree: { kind: "absent" } },
      },
    );

    expect(content).toEqual({
      items: [
        {
          path: TRANSFORM_PATH,
          change: "added",
          entity: { kind: "transform", name: "e2e_orders_by_status" },
          validation: { kind: "valid" },
          url: `${METABASE_URL}/data-studio/transforms/1`,
          transform: {
            id: 1,
            lastRun: { status: "succeeded", at: "2026-09-23T13:44:00.041151Z", message: null },
          },
        },
        {
          path: DASHBOARD_PATH,
          change: "modified",
          entity: { kind: "dashboard", name: "Orders Overview" },
          validation: { kind: "valid" },
          url: `${METABASE_URL}/dashboard/10`,
          transform: null,
        },
        {
          path: SEGMENT_PATH,
          change: "added",
          entity: { kind: "segment", name: "Big orders" },
          validation: {
            kind: "invalid",
            issues: [{ pointer: "/", message: "must have required property 'definition'" }],
          },
          url: null,
          transform: null,
        },
        {
          path: OLD_SEGMENT_PATH,
          change: "deleted",
          entity: { kind: "segment", name: "Old orders" },
          validation: null,
          url: null,
          transform: null,
        },
      ],
    });
    const calls = await repo.cli.calls();
    expect(calls.map((call) => call.args.slice(0, 2).join(" "))).toEqual([
      `validate ${TRANSFORM_PATH}`,
      "eid --body",
      "transform get",
    ]);
    expect(calls[0]?.args).toEqual([
      "validate",
      TRANSFORM_PATH,
      DASHBOARD_PATH,
      SEGMENT_PATH,
      "--json",
    ]);
  });

  it("asks Metabase nothing without an instance, so nothing opens there", async () => {
    const repo = await checkout();

    const content = await readSessionContent(
      { git, cli: repo.cli.cli, log: () => undefined },
      { cwd: repo.cwd, changed: { from: repo.from, files: CHANGED_FILES }, site: null },
    );

    expect(content.items.map((item) => [item.url, item.transform])).toEqual([
      [null, null],
      [null, null],
      [null, null],
      [null, null],
    ]);
    const calls = await repo.cli.calls();
    expect(calls.map((call) => call.args[0])).toEqual(["validate"]);
  });

  it("marks every file unchecked with the CLI's reason when validate cannot run", async () => {
    const repo = await checkout();
    await repo.cli.answer(`validate ${TRANSFORM_PATH}`, {
      stdout: "",
      stderr: "validate: out of memory",
      exit: 1,
    });

    const content = await readSessionContent(
      { git, cli: repo.cli.cli, log: () => undefined },
      { cwd: repo.cwd, changed: { from: repo.from, files: CHANGED_FILES }, site: null },
    );

    expect(content.items.map((item) => item.validation)).toEqual([
      { kind: "unchecked", reason: "validate: out of memory" },
      { kind: "unchecked", reason: "validate: out of memory" },
      { kind: "unchecked", reason: "validate: out of memory" },
      null,
    ]);
  });
});
