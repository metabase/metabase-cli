import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { ApiKey } from "../../src/domain/api-key";
import { parseJson } from "../../src/runtime/json";

import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";
import { E2E_GROUPS } from "./seed/ids";

const FIRST_NEW_API_KEY_ID = 3;
const KEY_NAME = "e2e_apikey";

describe("api-key e2e", () => {
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

  it("create returns the hydrated api-key with the unmasked key, the masked key, and the resolved permission group", async () => {
    const configHome = await makeIsolatedConfigHome();

    // --full bypasses the compact projection so unmasked_key is included.
    const result = await runCli({
      args: [
        "api-key",
        "create",
        "--name",
        KEY_NAME,
        "--group-id",
        String(E2E_GROUPS.ADMIN),
        "--full",
        "--json",
      ],
      configHome,
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);

    const created = parseJson(result.stdout, ApiKey);

    expect({
      id: created.id,
      name: created.name,
      group: created.group,
      hasUnmaskedKey: typeof created.unmasked_key === "string" && created.unmasked_key.length > 0,
      hasMaskedKey: typeof created.masked_key === "string" && created.masked_key.length > 0,
      keysDistinct: created.unmasked_key !== created.masked_key,
    }).toEqual({
      id: FIRST_NEW_API_KEY_ID,
      name: KEY_NAME,
      group: { id: E2E_GROUPS.ADMIN, name: "Administrators" },
      hasUnmaskedKey: true,
      hasMaskedKey: true,
      keysDistinct: true,
    });
  });

  it("create with a malformed --group-id (non-numeric) fails with ConfigError exit code", async () => {
    const configHome = await makeIsolatedConfigHome();

    const result = await runCli({
      args: ["api-key", "create", "--name", "irrelevant", "--group-id", "not-a-number", "--json"],
      configHome,
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("invalid --group-id");
  });

  it("create rejects --group-id without --name with ConfigError exit code", async () => {
    const configHome = await makeIsolatedConfigHome();

    const result = await runCli({
      args: ["api-key", "create", "--group-id", String(E2E_GROUPS.ADMIN), "--json"],
      configHome,
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--name is required when using --group-id");
  });
});
