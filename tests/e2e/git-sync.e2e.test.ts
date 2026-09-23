import { beforeAll, describe, expect, it } from "vitest";

import { SyncTree } from "@metabase/client/domain/git-sync";
import { parseJson } from "@metabase/client/json";

import { CurrentTaskResult } from "../../packages/cli/src/commands/git-sync/current-task";
import { SyncDirtyListEnvelope } from "../../packages/cli/src/commands/git-sync/dirty";
import { IsDirtyResult } from "../../packages/cli/src/commands/git-sync/is-dirty";
import { SyncStatus } from "../../packages/cli/src/commands/git-sync/status";
import { WaitResult } from "../../packages/cli/src/commands/git-sync/wait";
import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { runCli } from "./run-cli";
import { cliErrorCategory, cliErrorMessage } from "./cli-error";
import { requireServer } from "./server-gate";

const skipReason = requireServer("git-sync › git-sync e2e against EE git-sync endpoints", [
  "remoteSync",
]);

describe("git-sync arg validation e2e (no Metabase contact required)", () => {
  it("wait with non-integer --timeout fails fast with ConfigError before any network call", async () => {
    const result = await runCli({
      args: ["git-sync", "wait", "--timeout", "abc", "--json"],
    });
    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toBe('invalid timeout: "abc" (expected integer)');
    expect(result.stdout).toBe("");
  });

  it("wait with non-integer --interval fails fast with ConfigError before any network call", async () => {
    const result = await runCli({
      args: ["git-sync", "wait", "--interval", "xyz", "--json"],
    });
    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toBe('invalid interval: "xyz" (expected integer)');
    expect(result.stdout).toBe("");
  });
});

describe("git-sync tree e2e on every server", () => {
  let bootstrap: E2EBootstrap;

  beforeAll(async () => {
    bootstrap = await readBootstrap();
  });

  it("tree with --skip-preflight parses every collection the listing returns and finds none synced on the snapshot", async () => {
    const result = await runCli({
      args: ["git-sync", "tree", "--skip-preflight", "--json"],
      env: { MB_URL: bootstrap.baseUrl, MB_API_KEY: bootstrap.adminApiKey },
    });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, SyncTree)).toEqual({ collections: [] });
  });
});

describe.skipIf(skipReason !== null)("git-sync e2e against EE git-sync endpoints", () => {
  let bootstrap: E2EBootstrap;

  beforeAll(async () => {
    bootstrap = await readBootstrap();
  });

  function authEnv(): Record<string, string> {
    return {
      MB_URL: bootstrap.baseUrl,
      MB_API_KEY: bootstrap.adminApiKey,
    };
  }

  it("current-task returns the idle marker when no sync has ever run", async () => {
    const result = await runCli({
      args: ["git-sync", "current-task", "--json"],
      env: authEnv(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, CurrentTaskResult)).toEqual({ status: "idle" });
  });

  it("is-dirty reports false when no synced collections exist", async () => {
    const result = await runCli({
      args: ["git-sync", "is-dirty", "--json"],
      env: authEnv(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, IsDirtyResult)).toEqual({ is_dirty: false });
  });

  it("dirty returns an empty list envelope when nothing is dirty", async () => {
    const result = await runCli({
      args: ["git-sync", "dirty", "--json"],
      env: authEnv(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, SyncDirtyListEnvelope)).toEqual({
      data: [],
      returned: 0,
      offset: 0,
      total: 0,
      has_more: false,
      next_offset: null,
    });
  });

  it("status rolls up branch (null), is_dirty (false), and current_task (null)", async () => {
    const result = await runCli({
      args: ["git-sync", "status", "--json"],
      env: authEnv(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, SyncStatus)).toEqual({
      branch: null,
      is_dirty: false,
      current_task: null,
      synced_collections: [],
    });
  });

  it("tree answers no collections when nothing is marked for sync", async () => {
    const result = await runCli({
      args: ["git-sync", "tree", "--json"],
      env: authEnv(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, SyncTree)).toEqual({ collections: [] });
  });

  it("tree's text view says nothing is marked for sync", async () => {
    const result = await runCli({
      args: ["git-sync", "tree", "--format", "text"],
      env: authEnv(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toBe("No collections are marked for sync.\n");
  });

  it("wait exits successfully with the idle marker when no task is running", async () => {
    const result = await runCli({
      args: ["git-sync", "wait", "--json"],
      env: authEnv(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, WaitResult)).toEqual({ status: "idle" });
  });

  it("import without git-sync configured surfaces an HttpError", async () => {
    const result = await runCli({
      args: ["git-sync", "import", "--no-wait", "--json"],
      env: authEnv(),
    });
    expect(result.exitCode).toBe(1);
    expect(cliErrorCategory(result.stderr)).toBe("http");
  });

  it("has-remote-changes without git-sync configured surfaces the server's 400 message", async () => {
    const result = await runCli({
      args: ["git-sync", "has-remote-changes", "--json"],
      env: authEnv(),
    });
    expect(result.exitCode).toBe(1);
    expect(cliErrorMessage(result.stderr)).toBe("Remote sync is not configured.");
  });

  it("cancel-task surfaces the server's 400 message when there is no running task", async () => {
    const result = await runCli({
      args: ["git-sync", "cancel-task", "--json"],
      env: authEnv(),
    });
    expect(result.exitCode).toBe(1);
    expect(cliErrorMessage(result.stderr)).toBe("No active task to cancel");
  });

  it("branches surfaces an HttpError when no source URL is configured", async () => {
    const result = await runCli({
      args: ["git-sync", "branches", "--json"],
      env: authEnv(),
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Failed to clone git repository");
  });
});
