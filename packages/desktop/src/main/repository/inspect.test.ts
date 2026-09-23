import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runCommand, startProcess, type CommandResult } from "../process/spawn";

import { Git } from "../git/service";

import { inspectRepository } from "./inspect";

const GIT_TIMEOUT_MS = 10_000;
const GIT_OUTPUT_LIMIT_BYTES = 4 * 1024 * 1024;
const NEVER_ABORTED = new AbortController().signal;

// git refuses to commit without an identity, and a developer's own config must not decide what a
// test sees.
const GIT_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_AUTHOR_NAME: "RDE Test",
  GIT_AUTHOR_EMAIL: "rde@example.com",
  GIT_COMMITTER_NAME: "RDE Test",
  GIT_COMMITTER_EMAIL: "rde@example.com",
};

const directories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "rde-repository-"));
  directories.push(directory);
  return directory;
}

const git = new Git({ env: GIT_ENV, run: runCommand, start: startProcess, signal: NEVER_ABORTED });

async function runGit(cwd: string, ...args: string[]): Promise<CommandResult> {
  const result = await runCommand({
    command: "git",
    args: ["-C", cwd, ...args],
    env: GIT_ENV,
    cwd: null,
    timeoutMs: GIT_TIMEOUT_MS,
    maxOutputBytes: GIT_OUTPUT_LIMIT_BYTES,
    signal: NEVER_ABORTED,
  });
  if (result.kind !== "exited" || result.code !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${JSON.stringify(result)}`);
  }
  return result;
}

async function emptyRepository(): Promise<string> {
  const directory = await temporaryDirectory();
  await runGit(directory, "init", "-b", "main");
  return directory;
}

async function commit(directory: string, file: string): Promise<void> {
  const path = join(directory, file);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, "content\n", "utf8");
  await runGit(directory, "add", file);
  await runGit(directory, "commit", "-m", "seed");
}

function inspect(path: string): ReturnType<typeof inspectRepository> {
  return inspectRepository({ git, path });
}

afterEach(async () => {
  await Promise.all(
    directories.map((directory) => rm(directory, { recursive: true, force: true })),
  );
  directories.length = 0;
});

describe("inspectRepository", () => {
  it("rejects a folder that is not a git repository", async () => {
    const directory = await temporaryDirectory();

    expect(await inspect(directory)).toEqual({
      kind: "rejected",
      message: expect.stringContaining(`${directory} is not a git repository.`),
    });
  });

  it("reports a repository with no tracked files as empty", async () => {
    const directory = await emptyRepository();

    expect(await inspect(directory)).toEqual({
      kind: "chosen",
      repository: { path: directory, remote: null, defaultBranch: "main", layout: "empty" },
    });
  });

  it("reports a checkout holding the representation directories", async () => {
    const directory = await emptyRepository();
    await commit(directory, "collections/orders.yaml");

    expect(await inspect(directory)).toEqual({
      kind: "chosen",
      repository: {
        path: directory,
        remote: null,
        defaultBranch: "main",
        layout: "representation",
      },
    });
  });

  it("reports a checkout holding something else", async () => {
    const directory = await emptyRepository();
    await commit(directory, "README.md");

    expect(await inspect(directory)).toEqual({
      kind: "chosen",
      repository: { path: directory, remote: null, defaultBranch: "main", layout: "other" },
    });
  });

  it("reads the remote the checkout pushes to", async () => {
    const directory = await emptyRepository();
    await runGit(directory, "remote", "add", "origin", "https://github.com/metabase/content.git");

    expect(await inspect(directory)).toEqual({
      kind: "chosen",
      repository: {
        path: directory,
        remote: "https://github.com/metabase/content.git",
        defaultBranch: "main",
        layout: "empty",
      },
    });
  });
});
