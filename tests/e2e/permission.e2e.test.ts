import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { PermissionsGraph, PermissionsGraphRevision } from "@metabase/client/domain/permission";
import { parseJson } from "@metabase/client/json";

import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { cliErrorCategory, cliErrorMessage } from "./cli-error";
import { cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";
import { E2E_GROUPS } from "./seed/ids";
import { SEEDED } from "./seed/seeded";

const DB = String(SEEDED.warehouseDbId);

describe("permission e2e", () => {
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

  async function warehouseGraph(): Promise<PermissionsGraph> {
    const result = await runCli({
      args: ["permission", "graph", "--db", DB, "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });
    expect(result.exitCode, result.stderr).toBe(0);
    return parseJson(result.stdout, PermissionsGraph);
  }

  it("graph --db gives Administrators unrestricted view data on the warehouse", async () => {
    const graph = await warehouseGraph();

    expect(graph.groups[String(E2E_GROUPS.ADMIN)]?.[DB]?.["view-data"]).toBe("unrestricted");
  });

  it("update-graph applies the change and answers the new revision", async () => {
    const before = await warehouseGraph();
    const body = {
      revision: before.revision,
      groups: {
        // Allowed on every server; `blocked` view data needs the advanced-permissions feature.
        [String(E2E_GROUPS.ALL_USERS)]: {
          [DB]: { "view-data": "unrestricted", "create-queries": "query-builder" },
        },
      },
    };

    const result = await runCli({
      args: ["permission", "update-graph", "--body", JSON.stringify(body), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const { revision } = parseJson(result.stdout, PermissionsGraphRevision);
    expect(revision).toBeGreaterThan(before.revision);
    const after = await warehouseGraph();
    expect(after.revision).toBe(revision);
    expect(after.groups[String(E2E_GROUPS.ALL_USERS)]?.[DB]?.["create-queries"]).toBe(
      "query-builder",
    );
  });

  it("graph refuses --db with --group before any request", async () => {
    const result = await runCli({
      args: ["permission", "graph", "--db", DB, "--group", String(E2E_GROUPS.ADMIN), "--json"],
      configHome: await makeIsolatedConfigHome(),
      env: { MB_URL: bootstrap.baseUrl },
    });

    expect(result.exitCode).toBe(2);
    expect(cliErrorCategory(result.stderr)).toBe("config");
    expect(cliErrorMessage(result.stderr)).toBe("--db cannot be combined with --group");
    expect(result.stdout).toBe("");
  });
});
