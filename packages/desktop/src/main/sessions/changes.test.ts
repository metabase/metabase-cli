import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { Workspace } from "../../contracts/events";
import { projectSession } from "../../contracts/projector";
import type { SessionSnapshot } from "../../contracts/session";
import { captureCheckpoint, checkpointRef } from "../git/checkpoints";
import { Git, gitText } from "../git/service";
import { runCommand, startProcess } from "../process/spawn";

import { SessionChanges, restoreCheckout } from "./changes";
import { SessionCommandError } from "./errors";

const NEVER_ABORTED = new AbortController().signal;
const SESSION_ID = "ses_changes";
const TURN_ONE = "trn_one";
const TURN_TWO = "trn_two";
const AT = "2026-09-22T12:00:00.000Z";

const GIT_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_AUTHOR_NAME: "RDE Test",
  GIT_AUTHOR_EMAIL: "rde-test@example.com",
  GIT_COMMITTER_NAME: "RDE Test",
  GIT_COMMITTER_EMAIL: "rde-test@example.com",
};

const git = new Git({ env: GIT_ENV, run: runCommand, start: startProcess, signal: NEVER_ABORTED });

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.map((path) => rm(path, { recursive: true, force: true })));
  directories.length = 0;
});

async function temporaryDirectory(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix));
  directories.push(path);
  return path;
}

async function run(cwd: string, ...args: string[]): Promise<string> {
  return gitText(await git.write(cwd, args));
}

async function seededRepository(): Promise<string> {
  const root = await temporaryDirectory("rde-changes-");
  await run(root, "init", "--quiet", "--initial-branch=main");
  await writeFile(join(root, "orders.yaml"), "name: orders\n", "utf8");
  await writeFile(join(root, "customers.yaml"), "name: customers\n", "utf8");
  await run(root, "add", ".");
  await run(root, "commit", "--quiet", "-m", "seed");
  return root;
}

async function capture(root: string, seq: number): Promise<string> {
  const outcome = await captureCheckpoint({
    git,
    cwd: root,
    sessionId: SESSION_ID,
    seq,
    previousRef: seq === 0 ? null : checkpointRef(SESSION_ID, seq - 1),
  });
  if (outcome.kind === "failed") {
    throw new Error(outcome.message);
  }
  return outcome.ref;
}

function snapshotOf(workspace: Workspace, turns: readonly string[]): SessionSnapshot {
  const scope = { sessionId: SESSION_ID, at: AT };
  return projectSession([
    {
      ...scope,
      type: "session.created",
      id: "evt_0",
      seq: 0,
      title: "Clean the orders",
      provider: "claude",
      model: null,
      workspace,
      permissionMode: "ask",
    },
    ...turns.map((turnId, index) => ({
      ...scope,
      type: "checkpoint.captured" as const,
      id: `evt_${index + 1}`,
      seq: index + 1,
      turnId,
      ref: checkpointRef(SESSION_ID, index + 1),
      files: [],
    })),
  ]);
}

function changesFor(snapshot: SessionSnapshot, opened: string[] = []): SessionChanges {
  return new SessionChanges({
    git,
    open: async () => snapshot,
    repository: () => null,
    openUrl: async (url) => {
      opened.push(url);
      return true;
    },
    openFile: async () => ({ kind: "done" }),
    publishPush: () => undefined,
  });
}

function worktreeAt(path: string): Workspace {
  return { kind: "worktree", path, branch: "main", base: "main" };
}

interface TwoTurns {
  readonly root: string;
  readonly changes: SessionChanges;
}

async function twoTurns(): Promise<TwoTurns> {
  const root = await seededRepository();
  await capture(root, 0);
  await writeFile(join(root, "orders.yaml"), "name: orders\nrows: 12\n", "utf8");
  await writeFile(join(root, "segments.yaml"), "name: big_orders\n", "utf8");
  await capture(root, 1);
  await rm(join(root, "customers.yaml"));
  await capture(root, 2);
  return { root, changes: changesFor(snapshotOf(worktreeAt(root), [TURN_ONE, TURN_TWO])) };
}

describe("SessionChanges.read", () => {
  it("shows one turn's changes against the checkpoint before it", async () => {
    const { changes } = await twoTurns();

    const set = await changes.read({
      sessionId: SESSION_ID,
      scope: { kind: "turn", turnId: TURN_TWO },
      ignoreWhitespace: false,
      context: "hunks",
    });

    expect(set.from).toBe(checkpointRef(SESSION_ID, 1));
    expect(set.files).toEqual([
      {
        path: "customers.yaml",
        previousPath: null,
        change: "deleted",
        added: 0,
        removed: 1,
        binary: false,
      },
    ]);
  });

  it("shows the whole session against the baseline, new files the agent never staged included", async () => {
    const { root, changes } = await twoTurns();
    await writeFile(join(root, "measures.yaml"), "name: revenue\n", "utf8");

    const set = await changes.read({
      sessionId: SESSION_ID,
      scope: { kind: "all" },
      ignoreWhitespace: false,
      context: "hunks",
    });

    expect(set.from).toBe(checkpointRef(SESSION_ID, 0));
    expect(set.files.map((file) => `${file.change} ${file.path}`)).toEqual([
      "deleted customers.yaml",
      "added measures.yaml",
      "modified orders.yaml",
      "added segments.yaml",
    ]);
    expect(set.patch).toContain("+rows: 12");
  });

  it("widens every hunk to the whole file when the context is expanded", async () => {
    const root = await seededRepository();
    const lines = Array.from({ length: 20 }, (_, index) => `line ${index}`);
    await writeFile(join(root, "orders.yaml"), `${lines.join("\n")}\n`, "utf8");
    await run(root, "commit", "--quiet", "-am", "long file");
    await capture(root, 0);
    await writeFile(join(root, "orders.yaml"), `${[...lines, "line 20"].join("\n")}\n`, "utf8");
    await capture(root, 1);
    const changes = changesFor(snapshotOf(worktreeAt(root), [TURN_ONE]));
    const request = {
      sessionId: SESSION_ID,
      scope: { kind: "turn", turnId: TURN_ONE } as const,
      ignoreWhitespace: false,
    };

    const hunks = await changes.read({ ...request, context: "hunks" });
    const whole = await changes.read({ ...request, context: "file" });

    expect(hunks.patch).not.toContain(" line 0\n");
    expect(whole.patch).toContain(" line 0\n");
  });

  it("refuses a turn that has no checkpoint", async () => {
    const { changes } = await twoTurns();

    await expect(
      changes.read({
        sessionId: SESSION_ID,
        scope: { kind: "turn", turnId: "trn_missing" },
        ignoreWhitespace: false,
        context: "hunks",
      }),
    ).rejects.toThrow("Turn trn_missing has no checkpoint to show changes against.");
  });

  it("says the session's folder is gone instead of running git in it", async () => {
    const root = await seededRepository();
    await rm(root, { recursive: true });
    const changes = changesFor(snapshotOf(worktreeAt(root), []));

    const reading = changes.status(SESSION_ID);

    await expect(reading).rejects.toBeInstanceOf(SessionCommandError);
    await expect(reading).rejects.toThrow(
      `This session's folder, ${root}, is gone. The conversation is kept, but its files can't be read.`,
    );
  });
});

describe("SessionChanges.tree", () => {
  it("lists the checkout as it stands and marks what the session changed", async () => {
    const { root, changes } = await twoTurns();
    await writeFile(join(root, "measures.yaml"), "name: revenue\n", "utf8");

    expect(await changes.tree(SESSION_ID)).toEqual({
      paths: ["measures.yaml", "orders.yaml", "segments.yaml"],
      truncated: false,
      changed: [
        {
          path: "customers.yaml",
          previousPath: null,
          change: "deleted",
          added: 0,
          removed: 1,
          binary: false,
        },
        {
          path: "measures.yaml",
          previousPath: null,
          change: "added",
          added: 1,
          removed: 0,
          binary: false,
        },
        {
          path: "orders.yaml",
          previousPath: null,
          change: "modified",
          added: 1,
          removed: 0,
          binary: false,
        },
        {
          path: "segments.yaml",
          previousPath: null,
          change: "added",
          added: 1,
          removed: 0,
          binary: false,
        },
      ],
    });
  });
});

describe("SessionChanges.preview", () => {
  it("reads a file of the session's checkout", async () => {
    const { changes } = await twoTurns();

    expect(await changes.preview({ sessionId: SESSION_ID, path: "orders.yaml" })).toEqual({
      kind: "text",
      path: "orders.yaml",
      text: "name: orders\nrows: 12\n",
    });
  });

  it("refuses a path that climbs out of the checkout", async () => {
    const { changes } = await twoTurns();

    const reading = changes.preview({ sessionId: SESSION_ID, path: "../orders.yaml" });

    await expect(reading).rejects.toBeInstanceOf(SessionCommandError);
    await expect(reading).rejects.toThrow(
      "../orders.yaml is not a path inside the session's checkout.",
    );
  });
});

describe("SessionChanges.revert", () => {
  it("returns a modified file to the checkpoint's content", async () => {
    const { root, changes } = await twoTurns();

    const outcome = await changes.revert({
      sessionId: SESSION_ID,
      ref: checkpointRef(SESSION_ID, 0),
      path: "orders.yaml",
      previousPath: null,
    });

    expect(outcome).toEqual({ kind: "done" });
    expect(await readFile(join(root, "orders.yaml"), "utf8")).toBe("name: orders\n");
  });

  it("removes a file the checkpoint did not have", async () => {
    const { root, changes } = await twoTurns();

    await changes.revert({
      sessionId: SESSION_ID,
      ref: checkpointRef(SESSION_ID, 0),
      path: "segments.yaml",
      previousPath: null,
    });

    await expect(readFile(join(root, "segments.yaml"), "utf8")).rejects.toThrow("ENOENT");
  });

  it("brings back a file the turn deleted", async () => {
    const { root, changes } = await twoTurns();

    await changes.revert({
      sessionId: SESSION_ID,
      ref: checkpointRef(SESSION_ID, 1),
      path: "customers.yaml",
      previousPath: null,
    });

    expect(await readFile(join(root, "customers.yaml"), "utf8")).toBe("name: customers\n");
  });

  it("refuses a checkpoint that belongs to another session", async () => {
    const { changes } = await twoTurns();

    const outcome = await changes.revert({
      sessionId: SESSION_ID,
      ref: "refs/rde/checkpoints/ses_other/0",
      path: "orders.yaml",
      previousPath: null,
    });

    expect(outcome).toEqual({
      kind: "refused",
      message: "refs/rde/checkpoints/ses_other/0 is not a checkpoint of this session.",
    });
  });

  it("refuses a path that climbs out of the checkout", async () => {
    const { changes } = await twoTurns();

    const outcome = await changes.revert({
      sessionId: SESSION_ID,
      ref: checkpointRef(SESSION_ID, 0),
      path: "../outside.yaml",
      previousPath: null,
    });

    expect(outcome).toEqual({
      kind: "refused",
      message: "../outside.yaml is not a path inside the session's checkout.",
    });
  });
});

describe("restoreCheckout", () => {
  it("returns a worktree session's whole checkout to a checkpoint", async () => {
    const { root } = await twoTurns();

    await restoreCheckout(git, worktreeAt(root), SESSION_ID, checkpointRef(SESSION_ID, 0));

    expect(await readFile(join(root, "orders.yaml"), "utf8")).toBe("name: orders\n");
    expect(await readFile(join(root, "customers.yaml"), "utf8")).toBe("name: customers\n");
    await expect(readFile(join(root, "segments.yaml"), "utf8")).rejects.toThrow("ENOENT");
  });

  it("refuses a session that works in the repository itself", async () => {
    const { root } = await twoTurns();
    const inPlace: Workspace = { kind: "in-place", path: root, branch: "main", head: null };
    const restore = restoreCheckout(git, inPlace, SESSION_ID, checkpointRef(SESSION_ID, 0));

    await expect(restore).rejects.toThrow(SessionCommandError);
    await expect(
      restoreCheckout(git, inPlace, SESSION_ID, checkpointRef(SESSION_ID, 0)),
    ).rejects.toThrow(
      "Only a session in its own worktree can restore its files; this one works in the repository.",
    );
  });
});

interface PushedBranch {
  readonly root: string;
  readonly changes: SessionChanges;
  readonly opened: string[];
}

async function branchWithRemote(): Promise<PushedBranch> {
  const bare = await temporaryDirectory("rde-remote-");
  await run(bare, "init", "--quiet", "--bare");
  const root = await seededRepository();
  await run(root, "remote", "add", "origin", "https://github.com/metabase/analytics.git");
  await run(root, "remote", "set-url", "--push", "origin", bare);
  await run(root, "push", "--quiet", bare, "main");
  await run(root, "switch", "--quiet", "-c", "rde/clean-orders");
  const workspace: Workspace = {
    kind: "worktree",
    path: root,
    branch: "rde/clean-orders",
    base: "main",
  };
  const opened: string[] = [];
  return { root, changes: changesFor(snapshotOf(workspace, []), opened), opened };
}

describe("SessionChanges branch actions", () => {
  it("commits the checkout and pushes the branch until it is level with its upstream", async () => {
    const { root, changes } = await branchWithRemote();
    await writeFile(join(root, "segments.yaml"), "name: big_orders\n", "utf8");

    expect(await changes.commit({ sessionId: SESSION_ID, message: "Add big orders" })).toEqual({
      kind: "done",
    });
    expect(await changes.push({ sessionId: SESSION_ID, mode: "plain" })).toEqual({ kind: "done" });

    expect(await changes.status(SESSION_ID)).toEqual({
      branch: "rde/clean-orders",
      upstream: {
        kind: "tracking",
        divergence: { against: "origin/rde/clean-orders", ahead: 0, behind: 0 },
      },
      base: { against: "main", ahead: 1, behind: 0 },
      clean: true,
      ownBranch: true,
      pullRequest: {
        kind: "ready",
        url: "https://github.com/metabase/analytics/compare/main...rde/clean-orders?expand=1",
      },
    });
  });

  it("compares the branch with origin's copy of its base, which may be ahead of the local one", async () => {
    const { root, changes } = await branchWithRemote();
    await run(root, "switch", "--quiet", "main");
    await writeFile(join(root, "orders.yaml"), "name: orders\nowner: data\n", "utf8");
    await run(root, "commit", "--quiet", "-am", "Theirs");
    await run(root, "update-ref", "refs/remotes/origin/main", "HEAD");
    await run(root, "reset", "--quiet", "--hard", "HEAD~1");
    await run(root, "switch", "--quiet", "rde/clean-orders");

    const status = await changes.status(SESSION_ID);

    expect(status.base).toEqual({ against: "origin/main", ahead: 0, behind: 1 });
  });

  it("asks for a push before it offers a pull request", async () => {
    const { changes } = await branchWithRemote();

    expect(await changes.openPullRequest(SESSION_ID)).toEqual({
      kind: "refused",
      message: "Push rde/clean-orders before opening a pull request.",
    });
  });

  it("opens the compare page once the branch is pushed", async () => {
    const { changes, opened } = await branchWithRemote();
    await changes.push({ sessionId: SESSION_ID, mode: "plain" });

    const outcome = await changes.openPullRequest(SESSION_ID);

    const url = "https://github.com/metabase/analytics/compare/main...rde/clean-orders?expand=1";
    expect(outcome).toEqual({ kind: "opened", url });
    expect(opened).toEqual([url]);
  });

  it("says origin has commits the branch lacks when someone else pushed to it first", async () => {
    const { root, changes } = await branchWithRemote();
    await changes.push({ sessionId: SESSION_ID, mode: "plain" });
    const bare = gitText(await git.read(root, ["remote", "get-url", "--push", "origin"])).trim();
    const other = await temporaryDirectory("rde-other-");
    await run(other, "clone", "--quiet", "--branch", "rde/clean-orders", bare, ".");
    await writeFile(join(other, "orders.yaml"), "name: orders\nowner: someone else\n", "utf8");
    await run(other, "commit", "--quiet", "-am", "Theirs");
    await run(other, "push", "--quiet", "origin", "rde/clean-orders");
    await writeFile(join(root, "segments.yaml"), "name: big_orders\n", "utf8");
    await changes.commit({ sessionId: SESSION_ID, message: "Ours" });

    expect(await changes.push({ sessionId: SESSION_ID, mode: "plain" })).toEqual({
      kind: "refused",
      message:
        "origin has commits on rde/clean-orders that this branch doesn't. Merge them in, then push again.",
    });
  });

  it("refuses to force-push a branch the app did not create", async () => {
    const { root } = await branchWithRemote();
    const workspace: Workspace = { kind: "in-place", path: root, branch: null, head: null };
    const changes = changesFor(snapshotOf(workspace, []));

    expect(await changes.push({ sessionId: SESSION_ID, mode: "force-with-lease" })).toEqual({
      kind: "refused",
      message: "rde/clean-orders wasn't created by RDE, so it won't be force-pushed.",
    });
  });
});
