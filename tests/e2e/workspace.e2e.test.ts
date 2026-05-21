import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { createClient, type Client } from "../../src/core/http/client";
import { Workspace, WorkspaceCompact, type WorkspaceDatabase } from "../../src/domain/workspace";
import { parseJson } from "../../src/runtime/json";

import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";
import { SEEDED } from "./seed/seeded";
import { requireServer } from "./server-gate";
import { WorkspaceListEnvelope } from "../../src/commands/workspace/list";

const PROVISION_TIMEOUT_MS = 60_000;
const ANALYTICS_SCHEMA = "analytics";
const PUBLIC_SCHEMA = "public";
const FIRST_WORKSPACE_ID = 1;
const WORKSPACE_NAME = "e2e_workspace";

const skipReason = requireServer({ minVersion: 62, tokenFeature: "workspaces" });

describe.skipIf(skipReason !== null)("workspace e2e", () => {
  let bootstrap: E2EBootstrap;
  let adminClient: Client;
  const tempDirs: string[] = [];

  beforeAll(async () => {
    bootstrap = await readBootstrap();
    adminClient = createClient({ url: bootstrap.baseUrl, apiKey: bootstrap.adminApiKey });
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

  async function createWorkspace(): Promise<Workspace> {
    // --full bypasses the compact projection so creator/timestamps round-trip.
    const result = await runCli({
      args: ["workspace", "create", "--name", WORKSPACE_NAME, "--full", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    const created = parseJson(result.stdout, Workspace);
    expect(created.id).toBe(FIRST_WORKSPACE_ID);
    expect(created.name).toBe(WORKSPACE_NAME);
    expect(created.databases).toEqual([]);
    return created;
  }

  async function provisionDatabase(
    workspaceId: number,
    schemas: ReadonlyArray<string>,
  ): Promise<Workspace> {
    const result = await runCli({
      args: [
        "workspace",
        "database",
        "provision",
        String(workspaceId),
        "--database-id",
        String(SEEDED.warehouseDbId),
        "--schemas",
        schemas.join(","),
        "--full",
        "--json",
      ],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
      timeoutMs: PROVISION_TIMEOUT_MS,
    });
    expect(result.exitCode, result.stderr).toBe(0);
    return parseJson(result.stdout, Workspace);
  }

  function findWarehouseDatabase(workspace: Workspace): WorkspaceDatabase {
    const databases = workspace.databases ?? [];
    const entry = databases.find((row) => row.database_id === SEEDED.warehouseDbId);
    if (!entry) {
      throw new Error(
        `expected workspace ${workspace.id} to contain database ${SEEDED.warehouseDbId}, got: ${JSON.stringify(databases)}`,
      );
    }
    return entry;
  }

  it("create returns a hydrated workspace and list surfaces it (databases omitted on list)", async () => {
    await createWorkspace();

    const listResult = await runCli({
      args: ["workspace", "list", "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(listResult.exitCode, listResult.stderr).toBe(0);

    expect(parseJson(listResult.stdout, WorkspaceListEnvelope)).toEqual({
      data: [
        WorkspaceCompact.parse({
          id: FIRST_WORKSPACE_ID,
          name: WORKSPACE_NAME,
          databases: [],
        }),
      ],
      returned: 1,
      total: 1,
    });
  });

  it("database provision adds the warehouse and the post-provision status reaches provisioned", async () => {
    await createWorkspace();
    const provisioned = await provisionDatabase(FIRST_WORKSPACE_ID, [ANALYTICS_SCHEMA]);

    const entry = findWarehouseDatabase(provisioned);
    expect({
      database_id: entry.database_id,
      input_schemas: entry.input_schemas,
      status: entry.status,
      hasOutputNamespace: entry.output_namespace.length > 0,
    }).toEqual({
      database_id: SEEDED.warehouseDbId,
      input_schemas: [ANALYTICS_SCHEMA],
      status: "provisioned",
      hasOutputNamespace: true,
    });
  });

  it("database provision --wait returns the polled workspace with status=provisioned", async () => {
    await createWorkspace();

    const result = await runCli({
      args: [
        "workspace",
        "database",
        "provision",
        String(FIRST_WORKSPACE_ID),
        "--database-id",
        String(SEEDED.warehouseDbId),
        "--schemas",
        ANALYTICS_SCHEMA,
        "--wait",
        "--full",
        "--json",
      ],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
      timeoutMs: PROVISION_TIMEOUT_MS,
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const polled = parseJson(result.stdout, Workspace);
    const entry = findWarehouseDatabase(polled);
    expect(entry.status).toBe("provisioned");
  });

  it("database update changes the input schemas and re-provisions", async () => {
    await createWorkspace();
    await provisionDatabase(FIRST_WORKSPACE_ID, [ANALYTICS_SCHEMA]);

    const updateResult = await runCli({
      args: [
        "workspace",
        "database",
        "update",
        String(FIRST_WORKSPACE_ID),
        String(SEEDED.warehouseDbId),
        "--schemas",
        PUBLIC_SCHEMA,
        "--full",
        "--json",
      ],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
      timeoutMs: PROVISION_TIMEOUT_MS,
    });
    expect(updateResult.exitCode, updateResult.stderr).toBe(0);

    const updated = parseJson(updateResult.stdout, Workspace);
    const entry = findWarehouseDatabase(updated);
    expect({
      input_schemas: entry.input_schemas,
      status: entry.status,
    }).toEqual({
      input_schemas: [PUBLIC_SCHEMA],
      status: "provisioned",
    });
  });

  it("database deprovision removes the database from the workspace", async () => {
    await createWorkspace();
    await provisionDatabase(FIRST_WORKSPACE_ID, [ANALYTICS_SCHEMA]);

    const deprovisionResult = await runCli({
      args: [
        "workspace",
        "database",
        "deprovision",
        String(FIRST_WORKSPACE_ID),
        String(SEEDED.warehouseDbId),
        "--yes",
        "--json",
      ],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
      timeoutMs: PROVISION_TIMEOUT_MS,
    });
    expect(deprovisionResult.exitCode, deprovisionResult.stderr).toBe(0);

    // After deprovision the workspace's databases array is empty (or omitted).
    const after = await adminClient.requestParsed(
      Workspace,
      `/api/ee/workspace-manager/${FIRST_WORKSPACE_ID}`,
    );
    expect(after.databases ?? []).toEqual([]);
  });

  it("database update rejects --database-id smuggled in --body (backend's UpdateDatabaseParams is closed)", async () => {
    await createWorkspace();
    await provisionDatabase(FIRST_WORKSPACE_ID, [ANALYTICS_SCHEMA]);

    const result = await runCli({
      args: [
        "workspace",
        "database",
        "update",
        String(FIRST_WORKSPACE_ID),
        String(SEEDED.warehouseDbId),
        "--body",
        JSON.stringify({
          database_id: SEEDED.warehouseDbId,
          input: [{ schema: PUBLIC_SCHEMA }],
        }),
        "--json",
      ],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
      timeoutMs: PROVISION_TIMEOUT_MS,
    });

    // Backend returns 400 for the disallowed extra key; our HTTP layer
    // surfaces non-2xx as exit 1.
    expect(result.exitCode).toBe(1);
  });
});
