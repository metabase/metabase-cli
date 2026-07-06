import { afterEach, assert, beforeAll, describe, expect, it } from "vitest";

import { WorkspaceDestroyResult } from "../../src/commands/workspace/destroy";
import { WorkspaceListEnvelope } from "../../src/commands/workspace/list";
import { createClient, type Client } from "../../src/core/http/client";
import { WorkspaceCompact } from "../../src/domain/workspace";
import { parseJson } from "../../src/runtime/json";

import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { cliErrorMessage } from "./cli-error";
import { cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";
import { SEEDED } from "./seed/seeded";
import { requireServer, serverVersionBelow } from "./server-gate";

const WORKSPACE_MIN_VERSION = 62;
const skipReason = requireServer({
  minVersion: WORKSPACE_MIN_VERSION,
  tokenFeature: "workspaces",
});

const FIRST_WORKSPACE_ID = 1;
const WORKSPACE_NAME = "e2e_workspace";
const MISSING_WORKSPACE_ID = 9999999;
// The seeded warehouse's active table schemas; the server derives input schemas as the distinct
// non-blank schema names, sorted.
const WAREHOUSE_INPUT_SCHEMAS = ["analytics", "public"];
// Provisioning (schema + user DDL, blocking) makes create/destroy slower than plain CRUD calls.
const PROVISION_TIMEOUT_MS = 60_000;

const WORKSPACE_COMPACT = {
  id: FIRST_WORKSPACE_ID,
  name: WORKSPACE_NAME,
  created_at: expect.any(String),
  databases: [
    {
      database_id: SEEDED.warehouseDbId,
      input_schemas: WAREHOUSE_INPUT_SCHEMAS,
      output_namespace: expect.stringContaining("mb__isolation_"),
      status: "provisioned",
    },
  ],
};

describe.skipIf(skipReason !== null)("workspace e2e", () => {
  let bootstrap: E2EBootstrap;
  let adminClient: Client;
  const tempDirs: string[] = [];

  beforeAll(async () => {
    bootstrap = await readBootstrap();
    adminClient = createClient({
      url: bootstrap.baseUrl,
      credential: { kind: "apiKey", apiKey: bootstrap.adminApiKey },
    });
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

  // `database-enable-workspaces` is a database-local setting wiped by the per-test snapshot
  // restore, so every test that creates a workspace re-enables it first.
  async function enableWorkspacesOnWarehouse(): Promise<void> {
    await adminClient.requestRaw(`/api/database/${SEEDED.warehouseDbId}`, {
      method: "PUT",
      body: { settings: { "database-enable-workspaces": true } },
    });
  }

  async function createSeedWorkspace(): Promise<void> {
    await enableWorkspacesOnWarehouse();
    const result = await runCli({
      args: [
        "workspace",
        "create",
        "--name",
        WORKSPACE_NAME,
        "--database-ids",
        String(SEEDED.warehouseDbId),
        "--json",
      ],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
      timeoutMs: PROVISION_TIMEOUT_MS,
    });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, WorkspaceCompact)).toEqual(WORKSPACE_COMPACT);
  }

  it("list returns the just-created workspace as the only entry, databases hydrated", async () => {
    await createSeedWorkspace();

    const result = await runCli({
      args: ["workspace", "list", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, WorkspaceListEnvelope)).toEqual({
      data: [WORKSPACE_COMPACT],
      returned: 1,
      total: 1,
    });
  });

  it("create + get round-trip returns the provisioned workspace by id", async () => {
    await createSeedWorkspace();

    const result = await runCli({
      args: ["workspace", "get", String(FIRST_WORKSPACE_ID), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, WorkspaceCompact)).toEqual(WORKSPACE_COMPACT);
  });

  it("destroy --yes tears down the workspace; subsequent get returns 404", async () => {
    await createSeedWorkspace();

    const destroyResult = await runCli({
      args: ["workspace", "destroy", String(FIRST_WORKSPACE_ID), "--yes", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
      timeoutMs: PROVISION_TIMEOUT_MS,
    });
    expect(destroyResult.exitCode, destroyResult.stderr).toBe(0);
    expect(parseJson(destroyResult.stdout, WorkspaceDestroyResult)).toEqual({
      id: FIRST_WORKSPACE_ID,
      deleted: true,
      aborted: false,
    });

    const getResult = await runCli({
      args: ["workspace", "get", String(FIRST_WORKSPACE_ID), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(getResult.exitCode).toBe(1);
    expect(cliErrorMessage(getResult.stderr)).toContain(
      `Not found: GET /api/ee/workspace-manager/${FIRST_WORKSPACE_ID}.`,
    );
    expect(getResult.stdout).toBe("");
  });

  it("get on a missing workspace id surfaces the server 404", async () => {
    const result = await runCli({
      args: ["workspace", "get", String(MISSING_WORKSPACE_ID), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode).toBe(1);
    expect(cliErrorMessage(result.stderr)).toContain(
      `Not found: GET /api/ee/workspace-manager/${MISSING_WORKSPACE_ID}.`,
    );
    expect(result.stdout).toBe("");
  });
});

describe("workspace arg validation e2e (no Metabase contact required)", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(cleanupConfigHome));
  });

  async function makeIsolatedConfigHome(): Promise<string> {
    const dir = await mkTempConfigHome();
    tempDirs.push(dir);
    return dir;
  }

  it("get with a non-integer id fails fast with ConfigError", async () => {
    const result = await runCli({
      args: ["workspace", "get", "abc", "--json"],
      configHome: await makeIsolatedConfigHome(),
    });
    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toContain('invalid id: "abc" (expected integer)');
    expect(result.stdout).toBe("");
  });

  it("create with a non-integer database id fails fast with ConfigError", async () => {
    const result = await runCli({
      args: ["workspace", "create", "--name", "ws", "--database-ids", "1,abc", "--json"],
      configHome: await makeIsolatedConfigHome(),
    });
    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toContain(
      'invalid database id: "abc" (expected integer)',
    );
    expect(result.stdout).toBe("");
  });

  it("create with only separators in --database-ids fails fast with ConfigError", async () => {
    const result = await runCli({
      args: ["workspace", "create", "--name", "ws", "--database-ids", ",,", "--json"],
      configHome: await makeIsolatedConfigHome(),
    });
    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toContain(
      "expected at least one database id (comma separated)",
    );
    expect(result.stdout).toBe("");
  });

  it("destroy without --yes refuses non-interactively with ConfigError before any network call", async () => {
    const result = await runCli({
      args: ["workspace", "destroy", "5", "--json"],
      configHome: await makeIsolatedConfigHome(),
    });
    expect(result.exitCode).toBe(2);
    expect(cliErrorMessage(result.stderr)).toContain(
      "refusing to destroy workspace 5 without confirmation — pass --yes to proceed non-interactively",
    );
    expect(result.stdout).toBe("");
  });
});

describe.skipIf(!serverVersionBelow(WORKSPACE_MIN_VERSION))(
  "workspace capability gate against a sub-v62 server",
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

    it("workspace list refuses with CapabilityError (exit 2) naming the v62 requirement", async () => {
      const serverTag = bootstrap.server.version?.tag;
      assert(serverTag !== undefined, "gate block requires a known cached server version");
      const configHome = await makeIsolatedConfigHome();
      const login = await runCli({
        args: [
          "auth",
          "login",
          "--url",
          bootstrap.baseUrl,
          "--api-key",
          bootstrap.adminApiKey,
          "--json",
        ],
        configHome,
      });
      assert(login.exitCode === 0, login.stderr);

      const result = await runCli({ args: ["workspace", "list", "--json"], configHome });

      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain(
        `This command requires Metabase v${WORKSPACE_MIN_VERSION}+ (this server is ${serverTag}). Upgrade Metabase or pin mb-cli to an older release.`,
      );
      expect(result.stdout).toBe("");
    });
  },
);
