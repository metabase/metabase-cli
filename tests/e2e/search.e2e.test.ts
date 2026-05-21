import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { SearchListEnvelope } from "../../src/commands/search";
import { SEARCH_MODELS } from "../../src/domain/search";
import { parseJson } from "../../src/runtime/json";

import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";
import { SEEDED } from "./seed/seeded";
const ORDERS_BY_STATUS_COMPACT = {
  id: SEEDED.ordersCardId,
  name: "Orders by status",
  model: "card",
  description: null,
} as const;

describe("search e2e", () => {
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

  it("search with a query finds the seeded card and emits compact rows by default", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["search", "Orders by status", "--limit", "10", "--json"],
      configHome,
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, SearchListEnvelope)).toEqual({
      data: [ORDERS_BY_STATUS_COMPACT],
      returned: 1,
      total: 1,
      limit: 10,
    });
  });

  it("--models card narrows the result to the cards-only set", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["search", "--models", "card", "--limit", "20", "--json"],
      configHome,
      env: authEnv(),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, SearchListEnvelope)).toEqual({
      data: [ORDERS_BY_STATUS_COMPACT],
      returned: 1,
      total: 1,
      limit: 20,
    });
  });

  it("--models with an unknown value rejects with ConfigError", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["search", "--models", "card,nope", "--json"],
      configHome,
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(
      `invalid --models value: nope (expected one of: ${SEARCH_MODELS.join(", ")})`,
    );
    expect(result.stdout).toBe("");
  });

  it("--limit with a non-positive integer rejects with ConfigError", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["search", "--limit", "0", "--json"],
      configHome,
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("invalid --limit: 0 (must be ≥ 1)");
    expect(result.stdout).toBe("");
  });

  it("--table-db-id with a non-integer rejects with ConfigError", async () => {
    const configHome = await makeIsolatedConfigHome();
    const result = await runCli({
      args: ["search", "--table-db-id", "abc", "--json"],
      configHome,
      env: authEnv(),
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('invalid --table-db-id: "abc" (expected integer)');
    expect(result.stdout).toBe("");
  });
});
