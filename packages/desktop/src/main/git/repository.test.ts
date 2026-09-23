import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runCommand, startProcess } from "../process/spawn";

import { captureCheckpoint, checkpointRef } from "./checkpoints";

import {
  Git,
  TRACKED_FILE_LIMIT,
  branchExists,
  gitText,
  listCheckoutFiles,
  readCheckout,
} from "./service";
import { readPorcelainStatus } from "./status";
import { createWorktree, removeWorktree } from "./worktrees";

const NEVER_ABORTED = new AbortController().signal;

const SESSION_ID = "ses_test";
const BASE_BRANCH = "main";

// A test repository must not read the machine's own git configuration, or an author, a default
// branch or a hooks path from the box would decide what the assertions see.
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
  const root = await temporaryDirectory("rde-git-");
  await run(root, "init", "--quiet", `--initial-branch=${BASE_BRANCH}`);
  await writeFile(join(root, "README.md"), "seed\n", "utf8");
  await run(root, "add", "README.md");
  await run(root, "commit", "--quiet", "-m", "seed");
  return root;
}

async function stagedPaths(cwd: string): Promise<string[]> {
  const staged = await git.read(cwd, ["diff", "--cached", "--name-only"]);
  return gitText(staged)
    .split("\n")
    .filter((line) => line.length > 0);
}

describe("captureCheckpoint", () => {
  it("leaves the user's staging area exactly as they arranged it", async () => {
    const root = await seededRepository();
    await writeFile(join(root, "staged.txt"), "staged\n", "utf8");
    await writeFile(join(root, "loose.txt"), "loose\n", "utf8");
    await run(root, "add", "staged.txt");

    const outcome = await captureCheckpoint({
      git,
      cwd: root,
      sessionId: SESSION_ID,
      seq: 0,
      previousRef: null,
    });

    expect(outcome.kind).toBe("captured");
    expect(await stagedPaths(root)).toEqual(["staged.txt"]);
  });

  it("leaves no private index behind for the next capture to trip over", async () => {
    const root = await seededRepository();

    await captureCheckpoint({ git, cwd: root, sessionId: SESSION_ID, seq: 0, previousRef: null });

    const leftovers = (await readdir(join(root, ".git"))).filter((entry) =>
      entry.startsWith("rde-checkpoint-index-"),
    );
    expect(leftovers).toEqual([]);
  });

  it("names the files a turn changed against the checkpoint before it", async () => {
    const root = await seededRepository();
    await captureCheckpoint({ git, cwd: root, sessionId: SESSION_ID, seq: 0, previousRef: null });
    await writeFile(join(root, "hello.txt"), "hello\n", "utf8");

    const outcome = await captureCheckpoint({
      git,
      cwd: root,
      sessionId: SESSION_ID,
      seq: 1,
      previousRef: checkpointRef(SESSION_ID, 0),
    });

    expect(outcome).toEqual({
      kind: "captured",
      ref: `refs/rde/checkpoints/${SESSION_ID}/1`,
      files: [{ path: "hello.txt", added: 1, removed: 0 }],
    });
  });

  it("adds no commit to the branch the user is on", async () => {
    const root = await seededRepository();
    const before = await readCheckout(git, root);

    await captureCheckpoint({ git, cwd: root, sessionId: SESSION_ID, seq: 0, previousRef: null });

    expect(await readCheckout(git, root)).toEqual(before);
  });

  it("captures a repository that has no commit yet", async () => {
    const root = await temporaryDirectory("rde-git-");
    await run(root, "init", "--quiet", `--initial-branch=${BASE_BRANCH}`);
    await writeFile(join(root, "hello.txt"), "hello\n", "utf8");
    await captureCheckpoint({ git, cwd: root, sessionId: SESSION_ID, seq: 0, previousRef: null });
    await writeFile(join(root, "second.txt"), "second\n", "utf8");

    const outcome = await captureCheckpoint({
      git,
      cwd: root,
      sessionId: SESSION_ID,
      seq: 1,
      previousRef: checkpointRef(SESSION_ID, 0),
    });

    expect(outcome).toEqual({
      kind: "captured",
      ref: `refs/rde/checkpoints/${SESSION_ID}/1`,
      files: [{ path: "second.txt", added: 1, removed: 0 }],
    });
  });

  it("captures no file the repository ignores", async () => {
    const root = await seededRepository();
    await writeFile(join(root, ".gitignore"), "secret.txt\n", "utf8");
    await captureCheckpoint({ git, cwd: root, sessionId: SESSION_ID, seq: 0, previousRef: null });
    await writeFile(join(root, "secret.txt"), "token\n", "utf8");

    const outcome = await captureCheckpoint({
      git,
      cwd: root,
      sessionId: SESSION_ID,
      seq: 1,
      previousRef: checkpointRef(SESSION_ID, 0),
    });

    expect(outcome).toEqual({
      kind: "captured",
      ref: `refs/rde/checkpoints/${SESSION_ID}/1`,
      files: [],
    });
  });
});

describe("listCheckoutFiles", () => {
  async function repositoryTrackingTwoFiles(): Promise<string> {
    const root = await seededRepository();
    await writeFile(join(root, "notes.txt"), "notes\n", "utf8");
    await writeFile(join(root, "orders.sql"), "select 1\n", "utf8");
    await writeFile(join(root, ".gitignore"), "*.log\n", "utf8");
    await run(root, "add", "notes.txt", "orders.sql", ".gitignore");
    await run(root, "commit", "--quiet", "-m", "content");
    return root;
  }

  it("names the files git tracks and the new ones it does not ignore", async () => {
    const root = await repositoryTrackingTwoFiles();
    await writeFile(join(root, "scratch.txt"), "scratch\n", "utf8");
    await writeFile(join(root, "run.log"), "ran\n", "utf8");

    expect(await listCheckoutFiles(git, root, TRACKED_FILE_LIMIT)).toEqual({
      paths: [".gitignore", "README.md", "notes.txt", "orders.sql", "scratch.txt"],
      truncated: false,
    });
  });

  it("leaves out a tracked file deleted from disk", async () => {
    const root = await repositoryTrackingTwoFiles();
    await rm(join(root, "notes.txt"));

    expect(await listCheckoutFiles(git, root, TRACKED_FILE_LIMIT)).toEqual({
      paths: [".gitignore", "README.md", "orders.sql"],
      truncated: false,
    });
  });

  it("stops at the cap and says the answer is a window", async () => {
    const root = await repositoryTrackingTwoFiles();

    expect(await listCheckoutFiles(git, root, 2)).toEqual({
      paths: [".gitignore", "README.md"],
      truncated: true,
    });
  });
});

describe("createWorktree", () => {
  it("checks the branch out under the worktree root at the session's slug", async () => {
    const root = await seededRepository();
    const worktreeRoot = await temporaryDirectory("rde-worktrees-");

    const outcome = await createWorktree({
      git,
      root,
      worktreeRoot,
      slug: "clean-orders",
      branch: "rde/clean-orders",
      base: BASE_BRANCH,
    });

    expect(outcome.kind).toBe("created");
    const path = join(worktreeRoot, "clean-orders");
    expect(await readCheckout(git, path)).toEqual({
      branch: "rde/clean-orders",
      head: await headOf(root),
    });
  });

  it("refuses a branch that already exists rather than reusing it silently", async () => {
    const root = await seededRepository();
    const worktreeRoot = await temporaryDirectory("rde-worktrees-");
    await run(root, "branch", "rde/clean-orders");

    const outcome = await createWorktree({
      git,
      root,
      worktreeRoot,
      slug: "clean-orders",
      branch: "rde/clean-orders",
      base: BASE_BRANCH,
    });

    expect(outcome).toEqual({
      kind: "refused",
      message: "The branch rde/clean-orders already exists. Pick another name for this session.",
    });
  });

  it("refuses a base that names no commit", async () => {
    const root = await seededRepository();
    const worktreeRoot = await temporaryDirectory("rde-worktrees-");

    const outcome = await createWorktree({
      git,
      root,
      worktreeRoot,
      slug: "clean-orders",
      branch: "rde/clean-orders",
      base: "release-9",
    });

    expect(outcome).toEqual({
      kind: "refused",
      message: "release-9 names no commit in this repository, so there is nothing to branch from.",
    });
  });
});

describe("removeWorktree", () => {
  it("removes a clean checkout with nothing ahead of its base, and its branch", async () => {
    const root = await seededRepository();
    const worktreeRoot = await temporaryDirectory("rde-worktrees-");
    const created = await createWorktree({
      git,
      root,
      worktreeRoot,
      slug: "clean-orders",
      branch: "rde/clean-orders",
      base: BASE_BRANCH,
    });
    if (created.kind !== "created") {
      throw new Error(created.message);
    }

    const outcome = await removeWorktree({
      git,
      root,
      path: created.path,
      branch: "rde/clean-orders",
      base: BASE_BRANCH,
      sharedWith: 0,
    });

    expect(outcome).toEqual({ kind: "removed" });
    expect(await branchExists(git, root, "rde/clean-orders")).toBe(false);
  });

  it("keeps a checkout whose branch carries commits, and says how many", async () => {
    const root = await seededRepository();
    const worktreeRoot = await temporaryDirectory("rde-worktrees-");
    const created = await createWorktree({
      git,
      root,
      worktreeRoot,
      slug: "clean-orders",
      branch: "rde/clean-orders",
      base: BASE_BRANCH,
    });
    if (created.kind !== "created") {
      throw new Error(created.message);
    }
    await writeFile(join(created.path, "hello.txt"), "hello\n", "utf8");
    await run(created.path, "add", "hello.txt");
    await run(created.path, "commit", "--quiet", "-m", "hello");

    const outcome = await removeWorktree({
      git,
      root,
      path: created.path,
      branch: "rde/clean-orders",
      base: BASE_BRANCH,
      sharedWith: 0,
    });

    expect(outcome).toEqual({
      kind: "kept",
      reason: "rde/clean-orders is 1 commit ahead of main.",
    });
  });

  it("keeps a checkout another session is working in", async () => {
    const root = await seededRepository();
    const worktreeRoot = await temporaryDirectory("rde-worktrees-");
    const created = await createWorktree({
      git,
      root,
      worktreeRoot,
      slug: "clean-orders",
      branch: "rde/clean-orders",
      base: BASE_BRANCH,
    });
    if (created.kind !== "created") {
      throw new Error(created.message);
    }

    const outcome = await removeWorktree({
      git,
      root,
      path: created.path,
      branch: "rde/clean-orders",
      base: BASE_BRANCH,
      sharedWith: 1,
    });

    expect(outcome).toEqual({
      kind: "kept",
      reason: "1 other session works in this checkout.",
    });
  });

  it("keeps a checkout with changes that are not committed", async () => {
    const root = await seededRepository();
    const worktreeRoot = await temporaryDirectory("rde-worktrees-");
    const created = await createWorktree({
      git,
      root,
      worktreeRoot,
      slug: "clean-orders",
      branch: "rde/clean-orders",
      base: BASE_BRANCH,
    });
    if (created.kind !== "created") {
      throw new Error(created.message);
    }
    await writeFile(join(created.path, "hello.txt"), "hello\n", "utf8");
    expect((await readPorcelainStatus(git, created.path)).clean).toBe(false);

    const outcome = await removeWorktree({
      git,
      root,
      path: created.path,
      branch: "rde/clean-orders",
      base: BASE_BRANCH,
      sharedWith: 0,
    });

    expect(outcome).toEqual({
      kind: "kept",
      reason: "The checkout has changes that are not committed.",
    });
  });
});

async function headOf(cwd: string): Promise<string | null> {
  return (await readCheckout(git, cwd)).head;
}
