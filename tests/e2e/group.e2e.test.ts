import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { SavedPermissionGroupCompact } from "@metabase/client/domain/permission";
import { parseJson } from "@metabase/client/json";

import { DeleteResult } from "../../packages/cli/src/commands/delete-runtime";
import { PermissionGroupListEnvelope } from "../../packages/cli/src/commands/user-group/list";
import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { cliErrorCategory, cliErrorMessage } from "./cli-error";
import { cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";
import { E2E_GROUPS } from "./seed/ids";

// Names no server creates for itself (some ship a "Data Analysts" group; names are unique
// regardless of case).
const ANALYSTS = "e2e analysts";
const RENAMED = "e2e analysts (renamed)";

describe("group e2e", () => {
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

  async function listGroups() {
    const result = await mb(["group", "list", "--json", "--max-bytes", "0"]);
    expect(result.exitCode, result.stderr).toBe(0);
    return parseJson(result.stdout, PermissionGroupListEnvelope).data;
  }

  async function createAnalysts(): Promise<SavedPermissionGroupCompact> {
    const result = await mb(["group", "create", "--name", ANALYSTS, "--json"]);
    expect(result.exitCode, result.stderr).toBe(0);
    return parseJson(result.stdout, SavedPermissionGroupCompact);
  }

  // Other groups a server version creates for itself are not pinned, only the two every server has,
  // and their member counts follow the users the bootstrap made.
  it("list shows All Users and Administrators as built-in groups by their fixed ids", async () => {
    expect(await listGroups()).toEqual(
      expect.arrayContaining([
        {
          id: E2E_GROUPS.ALL_USERS,
          name: "All Users",
          magic_group_type: "all-internal-users",
          member_count: expect.any(Number),
        },
        {
          id: E2E_GROUPS.ADMIN,
          name: "Administrators",
          magic_group_type: "admin",
          member_count: expect.any(Number),
        },
      ]),
    );
  });

  it("create adds an empty group that list then shows", async () => {
    const created = await createAnalysts();

    expect(created).toEqual({ id: created.id, name: ANALYSTS, magic_group_type: null });
    expect((await listGroups()).find((group) => group.id === created.id)).toEqual({
      id: created.id,
      name: ANALYSTS,
      magic_group_type: null,
      member_count: 0,
    });
  });

  it("update renames the group", async () => {
    const created = await createAnalysts();
    const renamed = { id: created.id, name: RENAMED, magic_group_type: null };

    const result = await mb(["group", "update", String(created.id), "--name", RENAMED, "--json"]);

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, SavedPermissionGroupCompact)).toEqual(renamed);
    expect((await listGroups()).find((group) => group.id === created.id)).toEqual({
      ...renamed,
      member_count: 0,
    });
  });

  it("delete --yes removes the group", async () => {
    const created = await createAnalysts();

    const result = await mb(["group", "delete", String(created.id), "--yes", "--json"]);

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, DeleteResult)).toEqual({
      deleted: true,
      aborted: false,
      id: created.id,
    });
    expect((await listGroups()).some((group) => group.id === created.id)).toBe(false);
  });

  it("update of a missing id is a 404 HttpError", async () => {
    const result = await mb(["group", "update", "9999999", "--name", RENAMED, "--json"]);

    expect(result.exitCode).toBe(1);
    expect(cliErrorCategory(result.stderr)).toBe("http");
    expect(cliErrorMessage(result.stderr)).toBe("Not found: PUT /api/permissions/group/9999999.");
    expect(result.stdout).toBe("");
  });

  it("update with a non-integer id fails fast with ConfigError", async () => {
    const result = await mb(["group", "update", "abc", "--name", RENAMED, "--json"]);

    expect(result.exitCode).toBe(2);
    expect(cliErrorCategory(result.stderr)).toBe("config");
    expect(cliErrorMessage(result.stderr)).toBe('invalid id: "abc" (expected integer)');
    expect(result.stdout).toBe("");
  });

  it("update of a built-in group is refused by the server", async () => {
    const admins = String(E2E_GROUPS.ADMIN);

    const result = await mb(["group", "update", admins, "--name", RENAMED, "--json"]);

    expect(result.exitCode).toBe(1);
    expect(cliErrorCategory(result.stderr)).toBe("http");
    expect(cliErrorMessage(result.stderr)).toBe(
      "You cannot edit or delete the 'Administrators' permissions group!",
    );
    expect(result.stdout).toBe("");
  });

  it("delete without --yes refuses in non-TTY and exits 2", async () => {
    const created = await createAnalysts();

    const result = await mb(["group", "delete", String(created.id), "--json"]);

    expect(result.exitCode).toBe(2);
    expect(cliErrorCategory(result.stderr)).toBe("config");
    expect(cliErrorMessage(result.stderr)).toBe(
      `refusing to delete ${created.id} without confirmation — pass --yes to proceed non-interactively`,
    );
    expect(result.stdout).toBe("");
    expect((await listGroups()).some((group) => group.id === created.id)).toBe(true);
  });

  it("create with --name beside --body refuses before any request", async () => {
    const result = await runCli({
      args: ["group", "create", "--name", ANALYSTS, "--body", '{"name":"x"}', "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: { MB_URL: bootstrap.baseUrl },
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorCategory(result.stderr)).toBe("config");
    expect(cliErrorMessage(result.stderr)).toBe("--name cannot be combined with --body or --file");
    expect(result.stdout).toBe("");
  });

  it("create with a body that asks for a tenant group is refused by the strict schema", async () => {
    const body = JSON.stringify({ name: ANALYSTS, is_tenant_group: true });

    const result = await mb(["group", "create", "--body", body, "--json"]);

    expect(result.exitCode).toBe(1);
    expect(cliErrorCategory(result.stderr)).toBe("validation");
    expect(cliErrorMessage(result.stderr)).toBe(
      'request body: value did not match expected schema\n  /: Unrecognized key: "is_tenant_group"',
    );
    expect(result.stdout).toBe("");
  });
});
