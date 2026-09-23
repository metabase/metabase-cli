import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { OutputChunk } from "../../contracts/changes";
import type { ConnectionState } from "../../contracts/connection";
import type { SyncOutcome } from "../../contracts/events";
import { projectSession } from "../../contracts/projector";
import type { SessionSnapshot } from "../../contracts/session";
import {
  FIXTURE_CREDENTIALS,
  openCliFixture,
  recorded,
  type CliFixture,
  type FixtureCall,
} from "../cli/cli-fixture";
import { captureCheckpoint } from "../git/checkpoints";
import { Git, gitText } from "../git/service";
import { runCommand, startProcess } from "../process/spawn";
import { SessionChanges } from "../sessions/changes";

import { MetabaseLoop } from "./loop";
import { MetabaseWorktrees } from "./worktrees";

const NEVER_ABORTED = new AbortController().signal;
const SESSION_ID = "ses_loop";
const AT = "2026-09-22T12:00:00.000Z";
const BRANCH = "rde/big-orders";
const METABASE_URL = "http://metabase.test";
const DASHBOARD_EID = "dAsHbOaRd00000000000a";

const GIT_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_AUTHOR_NAME: "RDE Test",
  GIT_AUTHOR_EMAIL: "rde-test@example.com",
  GIT_COMMITTER_NAME: "RDE Test",
  GIT_COMMITTER_EMAIL: "rde-test@example.com",
};

const CONNECTED: ConnectionState = {
  kind: "connected",
  url: METABASE_URL,
  user: { id: 1, name: "Ada", email: "ada@example.com", isSuperuser: true },
  server: {
    version: "v1.60.0",
    edition: "ee",
    features: { remoteSync: true, transforms: true, transformTests: true },
  },
  connectedAt: AT,
};

const DASHBOARD_YAML = `name: Big orders
entity_id: ${DASHBOARD_EID}
collection_id: cOlLeCtIoN0000000000a
dashcards: []
serdes/meta:
  - id: ${DASHBOARD_EID}
    label: big_orders
    model: Dashboard
`;

const STATUS_JSON = JSON.stringify({
  branch: "main",
  is_dirty: false,
  current_task: null,
  synced_collections: [{ id: 5, name: "Analytics" }],
});

// Constructed, not recorded: the slot holds no licence, so it refuses every remote-sync route. The
// shapes are the CLI's `git-sync dirty` envelope and `has-remote-changes` answer.
const NO_EDITS_JSON = JSON.stringify({
  returned: 0,
  offset: 0,
  limit: 50,
  total: 0,
  has_more: false,
  next_offset: null,
  data: [],
});

const UP_TO_DATE_JSON = JSON.stringify({
  has_changes: false,
  remote_version: "b7e1f0c",
  local_version: "b7e1f0c",
  cached: false,
});

// Constructed, not recorded: the slot's Metabase has no worktrees.
const WORKTREE_ID = 7;
const WORKTREE_JSON = JSON.stringify({ id: WORKTREE_ID, branch: BRANCH, creator_id: 1 });

const WITHOUT_REMOTE_SYNC: ConnectionState = {
  ...CONNECTED,
  server: {
    version: "v1.60.0",
    edition: "oss",
    features: { remoteSync: false, transforms: true, transformTests: false },
  },
};

// A session ensures its worktree before its first read of Metabase, and reads remote sync inside it.
const PANEL_COMMANDS = [
  "git-sync worktree",
  "git-sync status",
  "git-sync dirty",
  "git-sync has-remote-changes",
];

const git = new Git({ env: GIT_ENV, run: runCommand, start: startProcess, signal: NEVER_ABORTED });

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) {
    await cleanup();
  }
});

async function temporaryDirectory(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix));
  cleanups.push(() => rm(path, { recursive: true, force: true }));
  return path;
}

async function run(cwd: string, ...args: string[]): Promise<string> {
  return gitText(await git.write(cwd, args));
}

interface Harness {
  readonly loop: MetabaseLoop;
  readonly cli: CliFixture;
  readonly checkout: string;
  readonly remote: string;
  readonly recordedSyncs: Array<{ branch: string; outcome: SyncOutcome }>;
  readonly output: string[];
}

async function harness(branch: string, connection: ConnectionState = CONNECTED): Promise<Harness> {
  const remote = await temporaryDirectory("rde-remote-");
  await run(remote, "init", "--quiet", "--bare", "--initial-branch=main");
  const checkout = await temporaryDirectory("rde-checkout-");
  await run(checkout, "init", "--quiet", "--initial-branch=main");
  await writeFile(join(checkout, "README.md"), "content\n", "utf8");
  await run(checkout, "add", ".");
  await run(checkout, "commit", "--quiet", "-m", "seed");
  await run(checkout, "remote", "add", "origin", remote);
  if (branch !== "main") {
    await run(checkout, "switch", "--quiet", "-c", branch);
  }
  const baseline = await captureCheckpoint({
    git,
    cwd: checkout,
    sessionId: SESSION_ID,
    seq: 0,
    previousRef: null,
  });
  if (baseline.kind === "failed") {
    throw new Error(baseline.message);
  }
  await mkdir(join(checkout, "collections", "main"), { recursive: true });
  await writeFile(join(checkout, "collections", "main", "big_orders.yaml"), DASHBOARD_YAML, "utf8");
  await run(checkout, "add", ".");
  await run(checkout, "commit", "--quiet", "-m", "Big orders dashboard");

  const snapshot: SessionSnapshot = projectSession([
    {
      type: "session.created",
      id: "evt_0",
      sessionId: SESSION_ID,
      seq: 0,
      at: AT,
      title: "Big orders",
      provider: "claude",
      model: null,
      workspace: { kind: "worktree", path: checkout, branch, base: "main" },
      permissionMode: "ask",
    },
  ]);
  const cli = await openCliFixture(FIXTURE_CREDENTIALS);
  cleanups.push(() => cli.close());
  await cli.answer("git-sync worktree", { stdout: WORKTREE_JSON, stderr: "", exit: 0 });
  await cli.answer("git-sync status", { stdout: STATUS_JSON, stderr: "", exit: 0 });
  await cli.answer("git-sync dirty", { stdout: NO_EDITS_JSON, stderr: "", exit: 0 });
  await cli.answer("git-sync has-remote-changes", { stdout: UP_TO_DATE_JSON, stderr: "", exit: 0 });
  const changes = new SessionChanges({
    git,
    open: async () => snapshot,
    repository: () => null,
    openUrl: async () => true,
    openFile: async () => ({ kind: "done" }),
    publishPush: () => undefined,
  });
  const recordedSyncs: Array<{ branch: string; outcome: SyncOutcome }> = [];
  const output: string[] = [];
  const loop = new MetabaseLoop({
    git,
    worktrees: new MetabaseWorktrees({
      cli: cli.cli,
      git,
      connection: () => connection,
      cwd: checkout,
      log: () => undefined,
    }),
    changes,
    open: async () => snapshot,
    connection: () => connection,
    recordSync: async (_sessionId, syncedBranch, outcome) => {
      recordedSyncs.push({ branch: syncedBranch, outcome });
    },
    publish: (chunk: OutputChunk) => {
      output.push(chunk.text);
    },
    log: () => undefined,
  });
  return { loop, cli, checkout, remote, recordedSyncs, output };
}

// The remote-sync reads run side by side, so the order they reach the CLI in is not asserted.
function commandsRun(calls: ReadonlyArray<{ args: readonly string[] }>): string[] {
  return calls.map((call) => call.args.slice(0, 2).join(" ")).toSorted();
}

function argsOf(calls: readonly FixtureCall[], command: string): readonly string[] | undefined {
  return calls.find((call) => call.args.slice(0, 2).join(" ") === command)?.args;
}

describe("MetabaseLoop.sync", () => {
  it("pushes the branch, imports it and records the import with links to what it holds", async () => {
    const loop = await harness(BRANCH);
    await loop.cli.answer("git-sync import", {
      stdout: JSON.stringify({ message: null, task_id: 12, final: null }),
      stderr: "",
      exit: 0,
    });
    await loop.cli.answer("eid --body", {
      stdout: JSON.stringify({
        entity_ids: { [DASHBOARD_EID]: { status: "ok", type: "dashboard", id: 31 } },
      }),
      stderr: "",
      exit: 0,
    });

    expect(await loop.loop.sync({ sessionId: SESSION_ID, confirmedGuard: false })).toEqual({
      kind: "done",
    });

    expect(await run(loop.remote, "rev-parse", BRANCH)).toBe(
      await run(loop.checkout, "rev-parse", "HEAD"),
    );
    expect(loop.recordedSyncs).toEqual([
      {
        branch: BRANCH,
        outcome: {
          kind: "imported",
          links: [
            {
              kind: "dashboard",
              title: "Big orders",
              url: `${METABASE_URL}/dashboard/31?worktree=${WORKTREE_ID}`,
            },
          ],
        },
      },
    ]);
    const calls = await loop.cli.calls();
    expect(commandsRun(calls)).toEqual(
      [...PANEL_COMMANDS, "git-sync import", "eid --body"].toSorted(),
    );
    expect(argsOf(calls, "git-sync import")).toEqual([
      "git-sync",
      "import",
      "--branch",
      BRANCH,
      "--json",
    ]);
    expect(calls.find((call) => call.args[1] === "import")?.env["MB_WORKTREE_ID"]).toBe(
      String(WORKTREE_ID),
    );
    expect(argsOf(calls, "eid --body")?.[2]).toBe(
      JSON.stringify({ entity_ids: { dashboard: [DASHBOARD_EID] } }),
    );
    const streamed = loop.output.join("");
    expect(streamed).toContain(`$ git push origin ${BRANCH}\n`);
    expect(streamed).toContain(`$ mb git-sync import --branch ${BRANCH}\n`);
    expect(streamed).toContain("Import task #12 succeeded.\n");
  });

  it("records the server's refusal as a failed sync", async () => {
    const loop = await harness(BRANCH);
    await loop.cli.answer("git-sync import", {
      stdout: "",
      stderr: await recorded("git-sync-status.unlicensed.stderr"),
      exit: 2,
    });
    const message =
      "This operation requires the 'remote_sync' premium feature (not enabled on this server).";

    expect(await loop.loop.sync({ sessionId: SESSION_ID, confirmedGuard: false })).toEqual({
      kind: "refused",
      message,
    });
    expect(loop.recordedSyncs).toEqual([{ branch: BRANCH, outcome: { kind: "failed", message } }]);
  });

  it("refuses a checkout with uncommitted changes before pushing or importing", async () => {
    const loop = await harness(BRANCH);
    await writeFile(join(loop.checkout, "README.md"), "edited\n", "utf8");

    expect(await loop.loop.sync({ sessionId: SESSION_ID, confirmedGuard: false })).toEqual({
      kind: "refused",
      message: "Commit the changes first. Metabase imports what's pushed.",
    });
    expect(commandsRun(await loop.cli.calls())).toEqual(PANEL_COMMANDS.toSorted());
    expect(loop.recordedSyncs).toEqual([]);
  });

  it("imports the tracked branch only once the guard is confirmed", async () => {
    const loop = await harness("main");
    await loop.cli.answer("git-sync import", {
      stdout: JSON.stringify({ message: "Already up to date", task_id: null }),
      stderr: "",
      exit: 0,
    });

    expect(await loop.loop.sync({ sessionId: SESSION_ID, confirmedGuard: false })).toEqual({
      kind: "refused",
      message:
        "main is the branch the instance tracks, so importing it replaces what everyone on this Metabase sees with this session's work.",
    });
    expect(loop.recordedSyncs).toEqual([]);

    expect(await loop.loop.sync({ sessionId: SESSION_ID, confirmedGuard: true })).toEqual({
      kind: "done",
    });
    expect(loop.recordedSyncs.map((synced) => synced.outcome.kind)).toEqual(["imported"]);
  });
});

describe("MetabaseLoop.panel", () => {
  it("reads the instance's sync state, the branch's readiness and the ignore file", async () => {
    const loop = await harness(BRANCH);

    expect(await loop.loop.panel(SESSION_ID)).toEqual({
      worktree: { kind: "ready", id: WORKTREE_ID, branch: BRANCH },
      remoteSync: {
        kind: "read",
        branch: "main",
        edits: [],
        remoteChanges: false,
        task: null,
        collectionCount: 1,
      },
      readiness: { kind: "ready", branch: BRANCH, push: true, guard: null },
      unignored: [".scratch/"],
    });
  });

  // Constructed, not recorded: the slot holds no licence, so it has no edits, remote changes or
  // running task to report.
  it("reads the edits made in Metabase, the remote's changes and a running import's progress", async () => {
    const loop = await harness(BRANCH);
    await loop.cli.answer("git-sync status", {
      stdout: JSON.stringify({
        branch: "main",
        is_dirty: true,
        current_task: {
          id: 3,
          sync_task_type: "import",
          status: "running",
          progress: 0.4,
          started_at: AT,
          ended_at: null,
          error_message: null,
        },
        synced_collections: [],
      }),
      stderr: "",
      exit: 0,
    });
    await loop.cli.answer("git-sync dirty", {
      stdout: JSON.stringify({
        returned: 2,
        offset: 0,
        limit: 50,
        total: 2,
        has_more: false,
        next_offset: null,
        data: [
          { id: 10, name: "Orders Overview", model: "dashboard", sync_status: "update" },
          { id: 11, name: null, model: "card", sync_status: "create" },
        ],
      }),
      stderr: "",
      exit: 0,
    });
    await loop.cli.answer("git-sync has-remote-changes", {
      stdout: JSON.stringify({
        has_changes: true,
        remote_version: "b7e1f0c",
        local_version: "4a2d9e3",
        cached: false,
      }),
      stderr: "",
      exit: 0,
    });

    expect((await loop.loop.panel(SESSION_ID)).remoteSync).toEqual({
      kind: "read",
      branch: "main",
      edits: [
        { id: 10, name: "Orders Overview", model: "dashboard" },
        { id: 11, name: null, model: "card" },
      ],
      remoteChanges: true,
      task: { kind: "import", status: "running", progress: 0.4, endedAt: null, message: null },
      collectionCount: 0,
    });
  });

  it("asks nothing of an instance without remote sync", async () => {
    const loop = await harness(BRANCH, WITHOUT_REMOTE_SYNC);

    expect((await loop.loop.panel(SESSION_ID)).remoteSync).toEqual({ kind: "off" });
    expect(await loop.cli.calls()).toEqual([]);
  });

  it("reads the instance's refusal as unavailable", async () => {
    const loop = await harness(BRANCH);
    await loop.cli.answer("git-sync status", {
      stdout: "",
      stderr: await recorded("git-sync-status.unlicensed.stderr"),
      exit: 2,
    });
    expect((await loop.loop.panel(SESSION_ID)).remoteSync).toEqual({
      kind: "unavailable",
      message:
        "This operation requires the 'remote_sync' premium feature (not enabled on this server).",
    });
  });
});

describe("MetabaseLoop.ignoreAppDirectories", () => {
  it("appends the app's directories to the checkout's .gitignore, once", async () => {
    const loop = await harness(BRANCH);
    await writeFile(join(loop.checkout, ".gitignore"), "node_modules/", "utf8");

    await loop.loop.ignoreAppDirectories(SESSION_ID);
    await loop.loop.ignoreAppDirectories(SESSION_ID);

    expect(await readFile(join(loop.checkout, ".gitignore"), "utf8")).toBe(
      "node_modules/\n.scratch/\n",
    );
    expect((await loop.loop.panel(SESSION_ID)).unignored).toEqual([]);
  });
});
