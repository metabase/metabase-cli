import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { WorkspaceCompact } from "@metabase/client/domain/workspace";
import { parseJson } from "@metabase/client/json";

import { DeleteResult } from "../../packages/cli/src/commands/delete-runtime";
import { WorkspaceConfigResult } from "../../packages/cli/src/commands/workspace/config";
import { CurrentWorkspaceResult } from "../../packages/cli/src/commands/workspace/current";
import { WorkspaceListEnvelope } from "../../packages/cli/src/commands/workspace/list";
import { parseYaml } from "../../packages/cli/src/runtime/yaml";
import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { cliErrorCategory, cliErrorMessage } from "./cli-error";
import { cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";
import { SEEDED } from "./seed/seeded";
import { requireServer } from "./server-gate";

const WORKSPACES_UNAVAILABLE = requireServer("workspace › with the workspaces feature", [
  "workspaces",
]);

const WORKSPACE_NAME = "e2e workspace";
const WAREHOUSE_DB_NAME = "Warehouse";

// No request is sent before these refusals, so the id names nothing.
const UNSENT_ID = "1";

// The part of a developer-instance config that names the workspace and the databases it works in.
const ConfigWorkspace = z.object({
  version: z.literal(1),
  config: z.object({
    workspace: z.object({
      name: z.string(),
      databases: z.record(z.string(), z.object({ input_schemas: z.array(z.string()) })),
    }),
  }),
});

describe("workspace e2e", () => {
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

  async function mb(args: string[]) {
    return runCli({ args, configHome: await makeIsolatedConfigHome(), env: authEnv() });
  }

  it("get with a non-integer id fails fast with ConfigError", async () => {
    const result = await mb(["workspace", "get", "abc", "--json"]);

    expect(result.exitCode).toBe(2);
    expect(cliErrorCategory(result.stderr)).toBe("config");
    expect(cliErrorMessage(result.stderr)).toBe('invalid id: "abc" (expected integer)');
    expect(result.stdout).toBe("");
  });

  it("create with --name alone refuses before any request", async () => {
    const result = await mb(["workspace", "create", "--name", WORKSPACE_NAME, "--json"]);

    expect(result.exitCode).toBe(2);
    expect(cliErrorCategory(result.stderr)).toBe("config");
    expect(cliErrorMessage(result.stderr)).toBe("--database-ids is required when using --name");
    expect(result.stdout).toBe("");
  });

  it("create with the flags beside --body refuses before any request", async () => {
    const body = JSON.stringify({ name: WORKSPACE_NAME, database_ids: [SEEDED.warehouseDbId] });

    const result = await mb([
      "workspace",
      "create",
      "--name",
      WORKSPACE_NAME,
      "--database-ids",
      String(SEEDED.warehouseDbId),
      "--body",
      body,
      "--json",
    ]);

    expect(result.exitCode).toBe(2);
    expect(cliErrorCategory(result.stderr)).toBe("config");
    expect(cliErrorMessage(result.stderr)).toBe(
      "--name, --database-ids cannot be combined with --body or --file",
    );
    expect(result.stdout).toBe("");
  });

  it("create with a database id that is not an integer fails fast with ConfigError", async () => {
    const result = await mb([
      "workspace",
      "create",
      "--name",
      WORKSPACE_NAME,
      "--database-ids",
      "1,x",
      "--json",
    ]);

    expect(result.exitCode).toBe(2);
    expect(cliErrorCategory(result.stderr)).toBe("config");
    expect(cliErrorMessage(result.stderr)).toBe('invalid database id: "x" (expected integer)');
    expect(result.stdout).toBe("");
  });

  it("delete without --yes refuses in non-TTY and exits 2", async () => {
    const result = await mb(["workspace", "delete", UNSENT_ID, "--json"]);

    expect(result.exitCode).toBe(2);
    expect(cliErrorCategory(result.stderr)).toBe("config");
    expect(cliErrorMessage(result.stderr)).toBe(
      `refusing to delete ${UNSENT_ID} without confirmation — pass --yes to proceed non-interactively`,
    );
    expect(result.stdout).toBe("");
  });

  it("delete with a non-integer id fails fast with ConfigError", async () => {
    const result = await mb(["workspace", "delete", "abc", "--yes", "--json"]);

    expect(result.exitCode).toBe(2);
    expect(cliErrorCategory(result.stderr)).toBe("config");
    expect(cliErrorMessage(result.stderr)).toBe('invalid id: "abc" (expected integer)');
    expect(result.stdout).toBe("");
  });

  it("config with a non-integer id fails fast with ConfigError", async () => {
    const result = await mb(["workspace", "config", "abc", "--json"]);

    expect(result.exitCode).toBe(2);
    expect(cliErrorCategory(result.stderr)).toBe("config");
    expect(cliErrorMessage(result.stderr)).toBe('invalid id: "abc" (expected integer)');
    expect(result.stdout).toBe("");
  });

  describe.skipIf(WORKSPACES_UNAVAILABLE !== null)("with the workspaces feature", () => {
    async function listWorkspaces() {
      const result = await mb(["workspace", "list", "--json"]);
      expect(result.exitCode, result.stderr).toBe(0);
      return parseJson(result.stdout, WorkspaceListEnvelope);
    }

    it("current answers no workspace on an instance that only manages them", async () => {
      const result = await mb(["workspace", "current", "--json"]);

      expect(result.exitCode, result.stderr).toBe(0);
      expect(parseJson(result.stdout, CurrentWorkspaceResult)).toEqual({ loaded: false });
    });

    it("list on the fresh snapshot is empty", async () => {
      expect(await listWorkspaces()).toEqual({
        data: [],
        returned: 0,
        offset: 0,
        total: 0,
        has_more: false,
        next_offset: null,
      });
    });

    it("get of a missing id is a 404 HttpError", async () => {
      const result = await mb(["workspace", "get", "9999999", "--json"]);

      expect(result.exitCode).toBe(1);
      expect(cliErrorCategory(result.stderr)).toBe("http");
      expect(cliErrorMessage(result.stderr)).toBe(
        "Not found: GET /api/ee/workspace-manager/9999999.",
      );
      expect(result.stdout).toBe("");
    });

    it("delete of a missing id is a 404 HttpError", async () => {
      const result = await mb(["workspace", "delete", "9999999", "--yes", "--json"]);

      expect(result.exitCode).toBe(1);
      expect(cliErrorCategory(result.stderr)).toBe("http");
      expect(cliErrorMessage(result.stderr)).toBe(
        "Not found: DELETE /api/ee/workspace-manager/9999999.",
      );
      expect(result.stdout).toBe("");
    });

    it("config of a missing id is a 404 HttpError", async () => {
      const result = await mb(["workspace", "config", "9999999", "--json"]);

      expect(result.exitCode).toBe(1);
      expect(cliErrorCategory(result.stderr)).toBe("http");
      expect(cliErrorMessage(result.stderr)).toBe(
        "Not found: GET /api/ee/workspace-manager/9999999/config.",
      );
      expect(result.stdout).toBe("");
    });

    // One workspace per run: provisioning leaves warehouse state the snapshot restore does not undo.
    it("create provisions the warehouse database, and get, list, config and delete then follow it", async () => {
      const created = await mb([
        "workspace",
        "create",
        "--name",
        WORKSPACE_NAME,
        "--database-ids",
        String(SEEDED.warehouseDbId),
        "--json",
      ]);

      expect(created.exitCode, created.stderr).toBe(0);
      const workspace = parseJson(created.stdout, WorkspaceCompact);
      const expected = {
        id: workspace.id,
        name: WORKSPACE_NAME,
        databases: [{ database_id: SEEDED.warehouseDbId, status: "provisioned" }],
      };
      expect(workspace).toEqual(expected);

      const fetched = await mb(["workspace", "get", String(workspace.id), "--json"]);
      expect(fetched.exitCode, fetched.stderr).toBe(0);
      expect(parseJson(fetched.stdout, WorkspaceCompact)).toEqual(expected);
      expect((await listWorkspaces()).data).toEqual([expected]);

      const config = await mb(["workspace", "config", String(workspace.id), "--json"]);
      expect(config.exitCode, config.stderr).toBe(0);
      const answered = parseJson(config.stdout, WorkspaceConfigResult);
      const parsed = parseYaml(answered.config, ConfigWorkspace);
      expect({
        id: answered.id,
        ...parsed.config.workspace,
        databases: Object.keys(parsed.config.workspace.databases),
      }).toEqual({
        id: workspace.id,
        name: WORKSPACE_NAME,
        databases: [WAREHOUSE_DB_NAME],
      });

      const deleted = await mb(["workspace", "delete", String(workspace.id), "--yes", "--json"]);
      expect(deleted.exitCode, deleted.stderr).toBe(0);
      expect(parseJson(deleted.stdout, DeleteResult)).toEqual({
        deleted: true,
        aborted: false,
        id: workspace.id,
      });
      expect((await listWorkspaces()).data).toEqual([]);
    });
  });
});
