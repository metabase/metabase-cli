import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { CurrentTaskResult } from "../../src/commands/git-sync/current-task";
import { SyncDirtyListEnvelope } from "../../src/commands/git-sync/dirty";
import { IsDirtyResult } from "../../src/commands/git-sync/is-dirty";
import { SyncStatus } from "../../src/commands/git-sync/status";
import { WaitResult } from "../../src/commands/git-sync/wait";
import { parseJson } from "../../src/runtime/json";

import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";
import { requireServer } from "./server-gate";

// remote-sync exists on v58 EE, but this suite exercises `has-remote-changes` (a v59
// endpoint) and v58's `remove-collection` server-NPEs on the idempotent path — the API
// only fully settles at v59, so gate the suite there.
const skipReason = requireServer({ minVersion: 59, edition: "ee", tokenFeature: "remote_sync" });

describe("git-sync arg validation e2e (no Metabase contact required)", () => {
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
      args: ["git-sync", "wait", "--timeout", "abc", "--json"],
      configHome,
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('invalid timeout: "abc" (expected integer)');
    expect(result.stdout).toBe("");
  });

  it("wait with non-integer --interval fails fast with ConfigError before any network call", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["git-sync", "wait", "--interval", "xyz", "--json"],
      configHome,
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('invalid interval: "xyz" (expected integer)');
    expect(result.stdout).toBe("");
  });

  it("stash with whitespace-only --new-branch fails with ConfigError", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["git-sync", "stash", "--new-branch", "   ", "--json"],
      configHome,
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("invalid new-branch: must not be blank");
    expect(result.stdout).toBe("");
  });

  it("stash with whitespace-only --message fails with ConfigError", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["git-sync", "stash", "--new-branch", "wip", "--message", "   ", "--json"],
      configHome,
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("invalid message: must not be blank");
    expect(result.stdout).toBe("");
  });

  it("create-branch with whitespace-only positional fails with ConfigError", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["git-sync", "create-branch", "   ", "--json"],
      configHome,
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("invalid name: branch name must not be blank");
    expect(result.stdout).toBe("");
  });

  it("add-collection with non-integer positional fails with ConfigError", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["git-sync", "add-collection", "abc", "--json"],
      configHome,
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('invalid id: "abc" (expected integer)');
    expect(result.stdout).toBe("");
  });

  it("add-collection with zero positional fails with ConfigError", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["git-sync", "add-collection", "0", "--json"],
      configHome,
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("invalid id: 0 (must be ≥ 1)");
    expect(result.stdout).toBe("");
  });

  it("remove-collection with negative positional fails with ConfigError", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["git-sync", "remove-collection", "--", "-3", "--json"],
      configHome,
    });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("invalid id: -3 (must be ≥ 1)");
    expect(result.stdout).toBe("");
  });
});

describe.skipIf(skipReason !== null)("git-sync e2e against EE git-sync endpoints", () => {
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
      args: ["git-sync", "current-task", "--json"],
      configHome,
      env: authEnv(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, CurrentTaskResult)).toEqual({ status: "idle" });
  });

  it("is-dirty reports false when no synced collections exist", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["git-sync", "is-dirty", "--json"],
      configHome,
      env: authEnv(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, IsDirtyResult)).toEqual({ is_dirty: false });
  });

  it("dirty returns an empty list envelope when nothing is dirty", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["git-sync", "dirty", "--json"],
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
      args: ["git-sync", "status", "--json"],
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
      args: ["git-sync", "wait", "--json"],
      configHome,
      env: authEnv(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, WaitResult)).toEqual({ status: "idle" });
  });

  it("import without git-sync configured surfaces a 400 HttpError", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["git-sync", "import", "--no-wait", "--json"],
      configHome,
      env: authEnv(),
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Metabase returned 400");
  });

  it("export without git-sync configured surfaces a 400 HttpError", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["git-sync", "export", "--no-wait", "--json"],
      configHome,
      env: authEnv(),
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Metabase returned 400");
  });

  it("has-remote-changes without git-sync configured surfaces a 400 HttpError", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["git-sync", "has-remote-changes", "--json"],
      configHome,
      env: authEnv(),
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Metabase returned 400");
  });

  it("cancel-task surfaces a 400 HttpError when there is no running task", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["git-sync", "cancel-task", "--json"],
      configHome,
      env: authEnv(),
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Metabase returned 400");
  });

  it("stash surfaces a 400 HttpError when remote-sync-type is not read-write", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["git-sync", "stash", "--new-branch", "wip", "--message", "x", "--no-wait", "--json"],
      configHome,
      env: authEnv(),
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Metabase returned 400");
  });

  it("branches surfaces an HttpError when no source URL is configured", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["git-sync", "branches", "--json"],
      configHome,
      env: authEnv(),
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Failed to clone git repository");
  });

  it("add-collection surfaces a 400 HttpError in the default config (read-only or paywall)", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["git-sync", "add-collection", "1", "--json"],
      configHome,
      env: authEnv(),
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Metabase returned 400");
  });

  it("remove-collection is idempotent when the collection is not in the sync config", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["git-sync", "remove-collection", "1", "--json"],
      configHome,
      env: authEnv(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ success: true });
  });
});
