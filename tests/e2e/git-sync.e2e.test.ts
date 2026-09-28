import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { parseJson } from "@metabase/client/json";

import { SyncSettingsUpdateResult } from "../../packages/cli/src/commands/git-sync/add-collection";
import { CurrentTaskResult } from "../../packages/cli/src/commands/git-sync/current-task";
import { SyncDirtyListEnvelope } from "../../packages/cli/src/commands/git-sync/dirty";
import { IsDirtyResult } from "../../packages/cli/src/commands/git-sync/is-dirty";
import { SyncStatus } from "../../packages/cli/src/commands/git-sync/status";
import { WaitResult } from "../../packages/cli/src/commands/git-sync/wait";
import { CommandHelpEntry } from "../../packages/cli/src/runtime/command-help";
import { readBootstrap, type E2EBootstrap, type ServerIdentity } from "./bootstrap-data";
import { cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";
import { cliErrorCategory, cliErrorMessage } from "./cli-error";
import { seedProbedProfile } from "./seed-profile";
import { requirementFailure, requireServer, serverHas } from "./server-gate";

const REMOTE_SYNC_REFUSAL =
  "This operation requires the 'remote_sync' premium feature (not enabled on this server).";
const DOWNGRADE_REMEDY = "Or install an `@metabase/cli` release that targets this server.";

const skipReason = requireServer("git-sync › git-sync e2e against EE git-sync endpoints", [
  "remoteSync",
]);
const preflightSkipReason = requireServer(
  "git-sync › export-preflight against a licensed server with the preflight route",
  ["remoteSyncExportPreflight"],
);
const preflightGap = requirementFailure(["remoteSyncExportPreflight"]);

function olderServerRefusal(serverTag: string): string {
  return `This operation requires Metabase v63+ (this server is ${serverTag}). Upgrade Metabase to use it.\n${DOWNGRADE_REMEDY}`;
}

function preflightLiveRefusal(server: ServerIdentity): string {
  if (preflightGap?.reason !== "version-too-old") {
    return REMOTE_SYNC_REFUSAL;
  }
  if (server.version === null) {
    throw new Error("a server with no parsed version is placed past the window, never below it");
  }
  return olderServerRefusal(server.version.tag);
}

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
    expect(cliErrorMessage(result.stderr)).toBe('invalid timeout: "abc" (expected integer)');
    expect(result.stdout).toBe("");
  });

  it("wait with non-integer --interval fails fast with ConfigError before any network call", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["git-sync", "wait", "--interval", "xyz", "--json"],
      configHome,
    });
    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toBe('invalid interval: "xyz" (expected integer)');
    expect(result.stdout).toBe("");
  });

  it("stash with whitespace-only --new-branch fails with ConfigError", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["git-sync", "stash", "--new-branch", "   ", "--json"],
      configHome,
    });
    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toBe("invalid new-branch: must not be blank");
    expect(result.stdout).toBe("");
  });

  it("stash with whitespace-only --message fails with ConfigError", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["git-sync", "stash", "--new-branch", "wip", "--message", "   ", "--json"],
      configHome,
    });
    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toBe("invalid message: must not be blank");
    expect(result.stdout).toBe("");
  });

  it("create-branch with whitespace-only positional fails with ConfigError", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["git-sync", "create-branch", "   ", "--json"],
      configHome,
    });
    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toBe("invalid name: branch name must not be blank");
    expect(result.stdout).toBe("");
  });

  it("add-collection with non-integer positional fails with ConfigError", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["git-sync", "add-collection", "abc", "--json"],
      configHome,
    });
    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toBe('invalid id: "abc" (expected integer)');
    expect(result.stdout).toBe("");
  });

  it("add-collection with zero positional fails with ConfigError", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["git-sync", "add-collection", "0", "--json"],
      configHome,
    });
    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toBe("invalid id: 0 (must be ≥ 1)");
    expect(result.stdout).toBe("");
  });

  it("remove-collection with negative positional fails with ConfigError", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["git-sync", "remove-collection", "--", "-3", "--json"],
      configHome,
    });
    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toBe("invalid id: -3 (must be ≥ 1)");
    expect(result.stdout).toBe("");
  });

  it("export-preflight refuses before any request when the cached probe lacks remote sync", async () => {
    const configHome = await makeIsolatedConfigHome();
    await seedProbedProfile(configHome, 64);

    const result = await runCli({ args: ["git-sync", "export-preflight", "--json"], configHome });

    expect(result.exitCode).toBe(2);
    expect(cliErrorCategory(result.stderr)).toBe("capability");
    expect(cliErrorMessage(result.stderr)).toBe(REMOTE_SYNC_REFUSAL);
    expect(result.stdout).toBe("");
  });

  it("export-preflight refuses before any request when the cached probe is older than the route", async () => {
    const configHome = await makeIsolatedConfigHome();
    await seedProbedProfile(configHome, 62);

    const result = await runCli({ args: ["git-sync", "export-preflight", "--json"], configHome });

    expect(result.exitCode).toBe(2);
    expect(cliErrorCategory(result.stderr)).toBe("capability");
    expect(cliErrorMessage(result.stderr)).toBe(olderServerRefusal("v0.62.0"));
    expect(result.stdout).toBe("");
  });

  it("help --json reports the preflight feature and the branch read behind export-preflight", async () => {
    const result = await runCli({
      args: ["git-sync", "export-preflight", "--help", "--json"],
      configHome: await makeIsolatedConfigHome(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const entry = parseJson(result.stdout, CommandHelpEntry, { source: "--help --json" });
    expect(entry.requires).toEqual({
      methods: ["gitSync.exportPreflight", "gitSync.trackedBranch"],
      features: ["remoteSyncExportPreflight"],
    });
  });
});

describe.skipIf(preflightSkipReason === null)(
  "git-sync export-preflight capability gate against a server without the preflight route",
  () => {
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

    it("export-preflight refuses with CapabilityError (exit 2) after a live probe", async () => {
      const result = await runCli({
        args: ["git-sync", "export-preflight", "--branch", "main", "--json"],
        configHome: await makeIsolatedConfigHome(),
        env: { MB_URL: bootstrap.baseUrl, MB_API_KEY: bootstrap.adminApiKey },
      });

      expect(result.exitCode).toBe(2);
      expect(cliErrorCategory(result.stderr)).toBe("capability");
      expect(cliErrorMessage(result.stderr)).toBe(preflightLiveRefusal(bootstrap.server));
      expect(result.stdout).toBe("");
    });
  },
);

describe.skipIf(preflightSkipReason !== null)(
  "git-sync › export-preflight against a licensed server with the preflight route",
  () => {
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

    async function runPreflight(...args: string[]) {
      return runCli({
        args: ["git-sync", "export-preflight", ...args, "--json"],
        configHome: await makeIsolatedConfigHome(),
        env: { MB_URL: bootstrap.baseUrl, MB_API_KEY: bootstrap.adminApiKey },
      });
    }

    it("refuses with ConfigError when no branch is tracked and none is passed", async () => {
      const result = await runPreflight();

      expect(result.exitCode).toBe(2);
      expect(cliErrorCategory(result.stderr)).toBe("config");
      expect(cliErrorMessage(result.stderr)).toBe(
        "git-sync tracks no branch: the remote-sync-branch setting is unset",
      );
      expect(result.stdout).toBe("");
    });

    it("surfaces the server's 400 message when a branch is passed but git-sync is not configured", async () => {
      const result = await runPreflight("--branch", "main");

      expect(result.exitCode).toBe(1);
      expect(cliErrorCategory(result.stderr)).toBe("http");
      expect(cliErrorMessage(result.stderr)).toBe("Remote sync is not configured.");
      expect(result.stdout).toBe("");
    });
  },
);

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
      MB_URL: bootstrap.baseUrl,
      MB_API_KEY: bootstrap.adminApiKey,
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
      offset: 0,
      total: 0,
      has_more: false,
      next_offset: null,
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
      synced_collections: [],
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

  it("import without git-sync configured refuses, before the request where the server expects a branch", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["git-sync", "import", "--no-wait", "--json"],
      configHome,
      env: authEnv(),
    });
    if (serverHas("remoteSyncBranchGuard")) {
      expect(result.exitCode).toBe(2);
      expect(cliErrorCategory(result.stderr)).toBe("config");
      expect(cliErrorMessage(result.stderr)).toBe(
        "git-sync tracks no branch: the remote-sync-branch setting is unset",
      );
      return;
    }
    expect(result.exitCode).toBe(1);
    expect(cliErrorCategory(result.stderr)).toBe("http");
  });

  it("export without git-sync configured refuses, before the request where the server expects a branch", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["git-sync", "export", "--no-wait", "--json"],
      configHome,
      env: authEnv(),
    });
    if (serverHas("remoteSyncBranchGuard")) {
      expect(result.exitCode).toBe(2);
      expect(cliErrorCategory(result.stderr)).toBe("config");
      expect(cliErrorMessage(result.stderr)).toBe(
        "git-sync tracks no branch: the remote-sync-branch setting is unset",
      );
      return;
    }
    expect(result.exitCode).toBe(1);
    expect(cliErrorCategory(result.stderr)).toBe("http");
  });

  it("has-remote-changes without git-sync configured surfaces the server's 400 message", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["git-sync", "has-remote-changes", "--json"],
      configHome,
      env: authEnv(),
    });
    expect(result.exitCode).toBe(1);
    expect(cliErrorMessage(result.stderr)).toBe("Remote sync is not configured.");
  });

  it("cancel-task surfaces the server's 400 message when there is no running task", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["git-sync", "cancel-task", "--json"],
      configHome,
      env: authEnv(),
    });
    expect(result.exitCode).toBe(1);
    expect(cliErrorMessage(result.stderr)).toBe("No active task to cancel");
  });

  it("stash surfaces the server's 400 message when remote-sync-type is not read-write", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["git-sync", "stash", "--new-branch", "wip", "--message", "x", "--no-wait", "--json"],
      configHome,
      env: authEnv(),
    });
    expect(result.exitCode).toBe(1);
    expect(cliErrorMessage(result.stderr)).toBe(
      "Stash is only allowed when remote-sync-type is set to 'read-write'",
    );
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

  it("add-collection surfaces the server's read-only 400 message in the default config", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["git-sync", "add-collection", "1", "--json"],
      configHome,
      env: authEnv(),
    });
    expect(result.exitCode).toBe(1);
    expect(cliErrorMessage(result.stderr)).toBe(
      "Cannot change synced collections when remote-sync-type is read-only.",
    );
  });

  it("remove-collection is idempotent when the collection is not in the sync config", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["git-sync", "remove-collection", "1", "--json"],
      configHome,
      env: authEnv(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, SyncSettingsUpdateResult)).toEqual({ success: true });
  });
});
