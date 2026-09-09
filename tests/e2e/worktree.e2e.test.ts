import { afterEach, beforeAll, describe, expect, it } from "vitest";

import type { z } from "zod";

import { TransformCompact } from "@metabase/client/domain/transform";
import { WorktreeCompact } from "@metabase/client/domain/worktree";
import { parseJson } from "@metabase/client/json";

import { LoginResult } from "../../packages/cli/src/commands/auth/login";
import { SyncStatus } from "../../packages/cli/src/commands/git-sync/status";
import { TransformListEnvelope } from "../../packages/cli/src/commands/transform/list";
import { WorktreeCreateResult } from "../../packages/cli/src/commands/worktree/create";
import { WorktreeDeleteResult } from "../../packages/cli/src/commands/worktree/delete";
import { WorktreeListEnvelope } from "../../packages/cli/src/commands/worktree/list";
import { WorktreePinResult } from "../../packages/cli/src/commands/worktree/pin";
import { WorktreeUnpinResult } from "../../packages/cli/src/commands/worktree/unpin";
import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { cliErrorMessage } from "./cli-error";
import { cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";
import { SEEDED } from "./seed/seeded";
import { requireServer } from "./server-gate";

const WORKTREE_BRANCH = "e2e/worktree-transforms";
const OTHER_BRANCH = "e2e/worktree-other";
const PINNED_PROFILE = "agent";
const TRANSFORM_NAME = "e2e_worktree_transform";

interface NativeQuery {
  type: "native";
  database: number;
  native: { query: string };
}

interface TransformTarget {
  type: "table";
  database: number;
  schema: string;
  name: string;
}

interface TransformBody {
  name: string;
  source: { type: "query"; query: NativeQuery };
  target: TransformTarget;
}

function transformBody(name: string): TransformBody {
  return {
    name,
    source: {
      type: "query",
      query: {
        type: "native",
        database: SEEDED.warehouseDbId,
        native: { query: "SELECT 1 AS one" },
      },
    },
    target: { type: "table", database: SEEDED.warehouseDbId, schema: "public", name },
  };
}

// The worktree endpoints and the `worktree-id` scope parameter on the content endpoints ship in
// Metabase 64, behind the same `remote_sync` premium feature as the rest of git-sync.
const skipReason = requireServer("worktree › worktree lifecycle against EE remote-sync endpoints", {
  minVersion: 64,
  tokenFeature: "remote_sync",
});

describe("worktree arg validation e2e (no Metabase contact required)", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(cleanupConfigHome));
  });

  async function makeIsolatedConfigHome(): Promise<string> {
    const dir = await mkTempConfigHome();
    tempDirs.push(dir);
    return dir;
  }

  it("get with a blank ref fails fast with ConfigError before any network call", async () => {
    const result = await runCli({
      args: ["worktree", "get", "   ", "--json"],
      configHome: await makeIsolatedConfigHome(),
    });
    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toBe("invalid worktree ref: value must not be blank");
    expect(result.stdout).toBe("");
  });

  it("get with a zero id ref fails with ConfigError", async () => {
    const result = await runCli({
      args: ["worktree", "get", "0", "--json"],
      configHome: await makeIsolatedConfigHome(),
    });
    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toBe("invalid worktree ref: 0 (must be ≥ 1)");
    expect(result.stdout).toBe("");
  });

  it("delete with a blank ref fails fast with ConfigError before any network call", async () => {
    const result = await runCli({
      args: ["worktree", "delete", "   ", "--json"],
      configHome: await makeIsolatedConfigHome(),
    });
    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toBe("invalid worktree ref: value must not be blank");
    expect(result.stdout).toBe("");
  });

  it("unpin reports an unpinned profile without contacting a server", async () => {
    const result = await runCli({
      args: ["worktree", "unpin", "--json"],
      configHome: await makeIsolatedConfigHome(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, WorktreeUnpinResult)).toEqual({
      profile: "default",
      unpinned: false,
    });
  });
});

describe.skipIf(skipReason !== null)("worktree lifecycle against EE remote-sync endpoints", () => {
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
    return { MB_URL: bootstrap.baseUrl, MB_API_KEY: bootstrap.adminApiKey };
  }

  // The e2e stack has no git remote, so every worktree here is created with the branch listing and
  // the initial pull skipped: `POST /worktree` records the row without reaching the remote.
  async function createWorktree(
    configHome: string,
    branch: string,
  ): Promise<z.infer<typeof WorktreeCreateResult>> {
    const result = await runCli({
      args: ["worktree", "create", branch, "--no-pull", "--no-create-branch", "--json"],
      configHome,
      env: authEnv(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    return parseJson(result.stdout, WorktreeCreateResult);
  }

  async function createTransform(
    configHome: string,
    name: string,
    scopeArgs: readonly string[],
  ): Promise<TransformCompact> {
    const result = await runCli({
      args: [
        "transform",
        "create",
        "--body",
        JSON.stringify(transformBody(name)),
        ...scopeArgs,
        "--json",
      ],
      configHome,
      env: authEnv(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    return parseJson(result.stdout, TransformCompact);
  }

  async function loginPinnedProfile(configHome: string): Promise<void> {
    const login = await runCli({
      args: [
        "auth",
        "login",
        "--profile",
        PINNED_PROFILE,
        "--url",
        bootstrap.baseUrl,
        "--api-key",
        bootstrap.adminApiKey,
        "--json",
      ],
      configHome,
    });
    expect(login.exitCode, login.stderr).toBe(0);
    expect(parseJson(login.stdout, LoginResult).profile).toBe(PINNED_PROFILE);
  }

  it("create with --no-pull --no-create-branch registers the row and reaches no remote", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["worktree", "create", WORKTREE_BRANCH, "--no-pull", "--no-create-branch", "--json"],
      configHome,
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, WorktreeCreateResult)).toEqual({
      worktree: {
        id: expect.any(Number),
        branch: WORKTREE_BRANCH,
        creator_id: expect.any(Number),
        created_at: expect.any(String),
      },
      branch_created: false,
      pull: null,
    });
  });

  it("create refuses a second worktree for a branch that already has one", async () => {
    const configHome = await makeIsolatedConfigHome();
    await createWorktree(configHome, WORKTREE_BRANCH);

    const duplicate = await runCli({
      args: ["worktree", "create", WORKTREE_BRANCH, "--no-pull", "--no-create-branch", "--json"],
      configHome,
      env: authEnv(),
    });

    expect(duplicate.exitCode).toBe(1);
    expect(cliErrorMessage(duplicate.stderr)).toBe(
      `A worktree for branch '${WORKTREE_BRANCH}' already exists.`,
    );
  });

  it("create without --no-create-branch surfaces the branch listing failure on an unconfigured server", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["worktree", "create", WORKTREE_BRANCH, "--no-pull", "--json"],
      configHome,
      env: authEnv(),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Failed to clone git repository");
  });

  it("list returns every worktree as a compact envelope", async () => {
    const configHome = await makeIsolatedConfigHome();
    const created = await createWorktree(configHome, WORKTREE_BRANCH);

    const list = await runCli({
      args: ["worktree", "list", "--json"],
      configHome,
      env: authEnv(),
    });

    expect(list.exitCode, list.stderr).toBe(0);
    expect(parseJson(list.stdout, WorktreeListEnvelope)).toEqual({
      data: [
        {
          id: created.worktree.id,
          branch: WORKTREE_BRANCH,
          creator_id: expect.any(Number),
          created_at: expect.any(String),
        },
      ],
      returned: 1,
      offset: 0,
      total: 1,
      has_more: false,
      next_offset: null,
    });
  });

  it("get resolves the same worktree from an id and from a branch name", async () => {
    const configHome = await makeIsolatedConfigHome();
    const created = await createWorktree(configHome, WORKTREE_BRANCH);
    const expected = {
      id: created.worktree.id,
      branch: WORKTREE_BRANCH,
      creator_id: expect.any(Number),
      created_at: expect.any(String),
    };

    const byId = await runCli({
      args: ["worktree", "get", String(created.worktree.id), "--json"],
      configHome,
      env: authEnv(),
    });
    const byBranch = await runCli({
      args: ["worktree", "get", WORKTREE_BRANCH, "--json"],
      configHome,
      env: authEnv(),
    });

    expect(byId.exitCode, byId.stderr).toBe(0);
    expect(byBranch.exitCode, byBranch.stderr).toBe(0);
    expect(parseJson(byId.stdout, WorktreeCompact)).toEqual(expected);
    expect(parseJson(byBranch.stdout, WorktreeCompact)).toEqual(expected);
  });

  it("get reports an unknown branch as a ConfigError naming the listing command", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["worktree", "get", OTHER_BRANCH, "--json"],
      configHome,
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toBe(
      `worktree "${OTHER_BRANCH}" not found; run \`mb worktree list\``,
    );
    expect(result.stdout).toBe("");
  });

  it("a transform created under --worktree is listed in the scope and not in the main app", async () => {
    const configHome = await makeIsolatedConfigHome();
    const created = await createWorktree(configHome, WORKTREE_BRANCH);
    const worktreeId = created.worktree.id;
    const transform = await createTransform(configHome, TRANSFORM_NAME, [
      "--worktree",
      String(worktreeId),
    ]);

    const scoped = await runCli({
      args: ["transform", "list", "--worktree", String(worktreeId), "--json"],
      configHome,
      env: authEnv(),
    });
    const mainApp = await runCli({
      args: ["transform", "list", "--json"],
      configHome,
      env: authEnv(),
    });

    expect(scoped.exitCode, scoped.stderr).toBe(0);
    expect(parseJson(scoped.stdout, TransformListEnvelope)).toEqual({
      data: [
        {
          id: transform.id,
          name: TRANSFORM_NAME,
          description: null,
          source_type: "native",
          target: {
            type: "table",
            database: SEEDED.warehouseDbId,
            schema: "public",
            name: TRANSFORM_NAME,
          },
          target_db_id: SEEDED.warehouseDbId,
          worktree_id: worktreeId,
        },
      ],
      returned: 1,
      offset: 0,
      total: 1,
      has_more: false,
      next_offset: null,
    });

    expect(mainApp.exitCode, mainApp.stderr).toBe(0);
    expect(parseJson(mainApp.stdout, TransformListEnvelope)).toEqual({
      data: [],
      returned: 0,
      offset: 0,
      total: 0,
      has_more: false,
      next_offset: null,
    });
  });

  it("transform get under MB_WORKTREE refuses a transform that lives in the main app", async () => {
    const configHome = await makeIsolatedConfigHome();
    const created = await createWorktree(configHome, WORKTREE_BRANCH);
    const worktreeId = created.worktree.id;
    const mainTransform = await createTransform(configHome, TRANSFORM_NAME, []);

    const result = await runCli({
      args: ["transform", "get", String(mainTransform.id), "--json"],
      configHome,
      env: { ...authEnv(), MB_WORKTREE: String(worktreeId) },
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toBe(
      `transform ${mainTransform.id} is not in worktree ${worktreeId} (${WORKTREE_BRANCH}); ` +
        "refusing to touch main-app content",
    );
    expect(result.stdout).toBe("");
  });

  it("a pinned profile refuses transform run and names the full verb chain", async () => {
    const configHome = await makeIsolatedConfigHome();
    await loginPinnedProfile(configHome);
    const created = await createWorktree(configHome, WORKTREE_BRANCH);
    const worktreeId = created.worktree.id;
    const mainTransform = await createTransform(configHome, TRANSFORM_NAME, []);

    const pin = await runCli({
      args: ["worktree", "pin", String(worktreeId), "--profile", PINNED_PROFILE, "--json"],
      configHome,
    });
    expect(pin.exitCode, pin.stderr).toBe(0);
    expect(parseJson(pin.stdout, WorktreePinResult)).toEqual({
      profile: PINNED_PROFILE,
      worktree: { id: worktreeId, branch: WORKTREE_BRANCH },
    });

    const run = await runCli({
      args: ["transform", "run", String(mainTransform.id), "--profile", PINNED_PROFILE, "--json"],
      configHome,
    });

    expect(run.exitCode).toBe(2);
    expect(cliErrorMessage(run.stderr)).toBe(
      `transform run is not available inside a worktree (scope: worktree ${worktreeId} ` +
        `(${WORKTREE_BRANCH}) from the profile pin); it changes main-app content. ` +
        "Unpin the profile (`mb worktree unpin`) or drop MB_WORKTREE to run it against the main app.",
    );
    expect(run.stdout).toBe("");
  });

  it("a pinned profile refuses a --worktree that names a different worktree", async () => {
    const configHome = await makeIsolatedConfigHome();
    await loginPinnedProfile(configHome);
    const pinned = await createWorktree(configHome, WORKTREE_BRANCH);
    const other = await createWorktree(configHome, OTHER_BRANCH);

    const pin = await runCli({
      args: ["worktree", "pin", String(pinned.worktree.id), "--profile", PINNED_PROFILE, "--json"],
      configHome,
    });
    expect(pin.exitCode, pin.stderr).toBe(0);

    const list = await runCli({
      args: [
        "transform",
        "list",
        "--worktree",
        String(other.worktree.id),
        "--profile",
        PINNED_PROFILE,
        "--json",
      ],
      configHome,
    });

    expect(list.exitCode).toBe(2);
    expect(cliErrorMessage(list.stderr)).toBe(
      `profile "${PINNED_PROFILE}" is pinned to worktree ${pinned.worktree.id} ` +
        `(${WORKTREE_BRANCH}); refusing --worktree ${other.worktree.id}`,
    );
    expect(list.stdout).toBe("");
  });

  it("git-sync status under a pin reports the worktree and no synced collections", async () => {
    const configHome = await makeIsolatedConfigHome();
    await loginPinnedProfile(configHome);
    const created = await createWorktree(configHome, WORKTREE_BRANCH);
    const worktreeId = created.worktree.id;

    const pin = await runCli({
      args: ["worktree", "pin", String(worktreeId), "--profile", PINNED_PROFILE, "--json"],
      configHome,
    });
    expect(pin.exitCode, pin.stderr).toBe(0);

    const status = await runCli({
      args: ["git-sync", "status", "--profile", PINNED_PROFILE, "--json"],
      configHome,
    });

    expect(status.exitCode, status.stderr).toBe(0);
    expect(parseJson(status.stdout, SyncStatus)).toEqual({
      branch: WORKTREE_BRANCH,
      worktree: { id: worktreeId, branch: WORKTREE_BRANCH },
      is_dirty: false,
      current_task: null,
      synced_collections: [],
    });
  });

  it("delete drops an empty worktree and releases the pin that named it", async () => {
    const configHome = await makeIsolatedConfigHome();
    await loginPinnedProfile(configHome);
    const created = await createWorktree(configHome, WORKTREE_BRANCH);
    const worktreeId = created.worktree.id;

    const pin = await runCli({
      args: ["worktree", "pin", String(worktreeId), "--profile", PINNED_PROFILE, "--json"],
      configHome,
    });
    expect(pin.exitCode, pin.stderr).toBe(0);

    const deleted = await runCli({
      args: ["worktree", "delete", String(worktreeId), "--profile", PINNED_PROFILE, "--json"],
      configHome,
    });

    expect(deleted.exitCode, deleted.stderr).toBe(0);
    expect(parseJson(deleted.stdout, WorktreeDeleteResult)).toEqual({
      id: worktreeId,
      branch: WORKTREE_BRANCH,
      deleted: true,
      unpinned: true,
    });
  });

  it("delete refuses a worktree holding unpushed changes until --force", async () => {
    const configHome = await makeIsolatedConfigHome();
    const created = await createWorktree(configHome, WORKTREE_BRANCH);
    const worktreeId = created.worktree.id;
    await createTransform(configHome, TRANSFORM_NAME, ["--worktree", String(worktreeId)]);

    const refused = await runCli({
      args: ["worktree", "delete", String(worktreeId), "--json"],
      configHome,
      env: authEnv(),
    });
    expect(refused.exitCode).toBe(2);
    expect(cliErrorMessage(refused.stderr)).toBe(
      `worktree ${worktreeId} (${WORKTREE_BRANCH}) has unpushed changes; ` +
        "push them with `mb git-sync export` or pass --force to discard",
    );

    const forced = await runCli({
      args: ["worktree", "delete", String(worktreeId), "--force", "--json"],
      configHome,
      env: authEnv(),
    });
    expect(forced.exitCode, forced.stderr).toBe(0);
    expect(parseJson(forced.stdout, WorktreeDeleteResult)).toEqual({
      id: worktreeId,
      branch: WORKTREE_BRANCH,
      deleted: true,
      unpinned: false,
    });
  });

  it("unpin releases a pin once and reports nothing to release on the second call", async () => {
    const configHome = await makeIsolatedConfigHome();
    await loginPinnedProfile(configHome);
    const created = await createWorktree(configHome, WORKTREE_BRANCH);

    const pin = await runCli({
      args: ["worktree", "pin", String(created.worktree.id), "--profile", PINNED_PROFILE, "--json"],
      configHome,
    });
    expect(pin.exitCode, pin.stderr).toBe(0);

    const first = await runCli({
      args: ["worktree", "unpin", "--profile", PINNED_PROFILE, "--json"],
      configHome,
    });
    const second = await runCli({
      args: ["worktree", "unpin", "--profile", PINNED_PROFILE, "--json"],
      configHome,
    });

    expect(first.exitCode, first.stderr).toBe(0);
    expect(parseJson(first.stdout, WorktreeUnpinResult)).toEqual({
      profile: PINNED_PROFILE,
      unpinned: true,
    });
    expect(second.exitCode, second.stderr).toBe(0);
    expect(parseJson(second.stdout, WorktreeUnpinResult)).toEqual({
      profile: PINNED_PROFILE,
      unpinned: false,
    });
  });
});
