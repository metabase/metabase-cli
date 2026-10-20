import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { Group } from "@metabase/client/domain/group";
import { parseJson } from "@metabase/client/json";

import { DeleteResult } from "../../packages/cli/src/commands/delete-runtime";
import { GroupListEnvelope } from "../../packages/cli/src/commands/user-group/list";
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
    return parseJson(result.stdout, GroupListEnvelope).data;
  }

  async function createAnalysts(): Promise<Group> {
    const result = await mb(["group", "create", "--name", ANALYSTS, "--json"]);
    expect(result.exitCode, result.stderr).toBe(0);
    return parseJson(result.stdout, Group);
  }

  // Other groups a server version creates for itself are not pinned, only the two every server has.
  it("list shows All Users and Administrators by their fixed ids", async () => {
    const ids = (await listGroups()).map((group) => [group.id, group.name]);

    expect(ids).toEqual(
      expect.arrayContaining([
        [E2E_GROUPS.ALL_USERS, "All Users"],
        [E2E_GROUPS.ADMIN, "Administrators"],
      ]),
    );
  });

  it("create adds an empty group that list then shows", async () => {
    const created = await createAnalysts();

    expect(created).toEqual({ id: created.id, name: ANALYSTS });
    expect((await listGroups()).find((group) => group.id === created.id)).toEqual({
      id: created.id,
      name: ANALYSTS,
      member_count: 0,
    });
  });

  it("update renames the group", async () => {
    const created = await createAnalysts();

    const result = await mb(["group", "update", String(created.id), "--name", RENAMED, "--json"]);

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, Group).name).toBe(RENAMED);
    expect((await listGroups()).find((group) => group.id === created.id)?.name).toBe(RENAMED);
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
});
