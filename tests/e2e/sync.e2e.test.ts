import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { CurrentTaskResult } from "../../src/commands/sync/current-task";
import { SyncDirtyListEnvelope } from "../../src/commands/sync/dirty";
import { IsDirtyResult } from "../../src/commands/sync/is-dirty";
import { SyncStatus } from "../../src/commands/sync/status";
import { WaitResult } from "../../src/commands/sync/wait";
import { parseJson } from "../../src/runtime/json";

import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";

describe("sync arg validation e2e (no Metabase contact required)", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(cleanupConfigHome));
  });

  async function makeIsolatedConfigHome(): Promise<string> {
    const dir = await mkTempConfigHome();
    tempDirs.push(dir);
    return dir;
  }

  it("wait with non-integer --timeout fails fast with ConfigError before any network call", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["sync", "wait", "--timeout", "abc", "--json"],
      configHome,
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('invalid timeout: "abc" (expected integer)');
    expect(result.stdout).toBe("");
  });

  it("wait with non-integer --interval fails fast with ConfigError before any network call", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["sync", "wait", "--interval", "xyz", "--json"],
      configHome,
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('invalid interval: "xyz" (expected integer)');
    expect(result.stdout).toBe("");
  });

  it("stash with whitespace-only --new-branch fails with ConfigError", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["sync", "stash", "--new-branch", "   ", "--json"],
      configHome,
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("invalid new-branch: must not be blank");
    expect(result.stdout).toBe("");
  });

  it("stash with whitespace-only --message fails with ConfigError", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["sync", "stash", "--new-branch", "wip", "--message", "   ", "--json"],
      configHome,
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("invalid message: must not be blank");
    expect(result.stdout).toBe("");
  });

  it("create-branch with whitespace-only positional fails with ConfigError", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["sync", "create-branch", "   ", "--json"],
      configHome,
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("invalid name: branch name must not be blank");
    expect(result.stdout).toBe("");
  });
});

describe("sync e2e against EE remote-sync endpoints", () => {
  let bootstrap: E2EBootstrap;
  const tempDirs: string[] = [];

  beforeAll(async () => {
    bootstrap = await readBootstrap();
  });

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(cleanupConfigHome));
  });

  async function makeIsolatedConfigHome(): Promise<string> {
    const dir = await mkTempConfigHome();
    tempDirs.push(dir);
    return dir;
  }

  function authEnv(): Record<string, string> {
    return {
      METABASE_URL: bootstrap.baseUrl,
      METABASE_API_KEY: bootstrap.adminApiKey,
    };
  }

  it("current-task returns the idle marker when no sync has ever run", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["sync", "current-task", "--json"],
      configHome,
      env: authEnv(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, CurrentTaskResult)).toEqual({ status: "idle" });
  });

  it("is-dirty reports false when no synced collections exist", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["sync", "is-dirty", "--json"],
      configHome,
      env: authEnv(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, IsDirtyResult)).toEqual({ is_dirty: false });
  });

  it("dirty returns an empty list envelope when nothing is dirty", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["sync", "dirty", "--json"],
      configHome,
      env: authEnv(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, SyncDirtyListEnvelope)).toEqual({
      data: [],
      returned: 0,
      total: 0,
    });
  });

  it("status rolls up branch (null), is_dirty (false), and current_task (null)", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["sync", "status", "--json"],
      configHome,
      env: authEnv(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, SyncStatus)).toEqual({
      branch: null,
      is_dirty: false,
      current_task: null,
    });
  });

  it("wait exits successfully with the idle marker when no task is running", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["sync", "wait", "--json"],
      configHome,
      env: authEnv(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, WaitResult)).toEqual({ status: "idle" });
  });

  it("import without remote-sync configured surfaces a 400 HttpError", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["sync", "import", "--no-wait", "--json"],
      configHome,
      env: authEnv(),
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Metabase returned 400");
  });

  it("export without remote-sync configured surfaces a 400 HttpError", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["sync", "export", "--no-wait", "--json"],
      configHome,
      env: authEnv(),
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Metabase returned 400");
  });

  it("has-remote-changes without remote-sync configured surfaces a 400 HttpError", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["sync", "has-remote-changes", "--json"],
      configHome,
      env: authEnv(),
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Metabase returned 400");
  });

  it("cancel-task surfaces a 400 HttpError when there is no running task", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["sync", "cancel-task", "--json"],
      configHome,
      env: authEnv(),
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Metabase returned 400");
  });

  it("stash surfaces a 400 HttpError when remote-sync-type is not read-write", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["sync", "stash", "--new-branch", "wip", "--message", "x", "--no-wait", "--json"],
      configHome,
      env: authEnv(),
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Metabase returned 400");
  });

  it("branches surfaces an HttpError when no source URL is configured", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["sync", "branches", "--json"],
      configHome,
      env: authEnv(),
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Failed to clone git repository");
  });
});
