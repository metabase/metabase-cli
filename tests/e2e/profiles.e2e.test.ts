import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { LoginResult } from "../../src/commands/auth/login";
import { LogoutResult } from "../../src/commands/auth/logout";
import { AuthStatus } from "../../src/commands/auth/status";
import { DatabaseListEnvelope } from "../../src/commands/db/list";
import { CardQueryResult } from "../../src/domain/card";
import { parseJson } from "../../src/runtime/json";

import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";
import { E2E_CARDS, E2E_DATABASES } from "./seed/ids";

describe("profiles e2e", () => {
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

  interface LoginCredentials {
    apiKey: string;
    email: string;
  }

  async function loginProfile(
    configHome: string,
    profile: string,
    credentials: LoginCredentials = {
      apiKey: bootstrap.adminApiKey,
      email: bootstrap.adminApiKeyEmail,
    },
  ): Promise<void> {
    const login = await runCli({
      args: [
        "auth",
        "login",
        "--profile",
        profile,
        "--url",
        bootstrap.baseUrl,
        "--api-key",
        credentials.apiKey,
        "--json",
      ],
      configHome,
    });
    expect(login.exitCode, login.stderr).toBe(0);
    expect(parseJson(login.stdout, LoginResult)).toEqual({
      profile,
      url: bootstrap.baseUrl,
      authenticated: true,
      email: credentials.email,
    });
  }

  it("login --profile stores credentials only under that profile", async () => {
    const configHome = await makeIsolatedConfigHome();
    await loginProfile(configHome, "staging");

    const stagingStatus = await runCli({
      args: ["auth", "status", "--profile", "staging", "--json"],
      configHome,
    });
    expect(stagingStatus.exitCode, stagingStatus.stderr).toBe(0);
    expect(parseJson(stagingStatus.stdout, AuthStatus)).toEqual({
      profile: "staging",
      present: true,
      url: bootstrap.baseUrl,
    });

    const defaultStatus = await runCli({
      args: ["auth", "status", "--json"],
      configHome,
    });
    expect(defaultStatus.exitCode, defaultStatus.stderr).toBe(0);
    expect(parseJson(defaultStatus.stdout, AuthStatus)).toEqual({
      profile: "default",
      present: false,
      url: null,
    });
  });

  it("logout --profile clears only the named profile", async () => {
    const configHome = await makeIsolatedConfigHome();
    await loginProfile(configHome, "staging");
    await loginProfile(configHome, "prod");

    const logout = await runCli({
      args: ["auth", "logout", "--profile", "prod", "--yes", "--json"],
      configHome,
    });
    expect(logout.exitCode, logout.stderr).toBe(0);
    expect(parseJson(logout.stdout, LogoutResult)).toEqual({
      profile: "prod",
      cleared: true,
      aborted: false,
    });

    const prodStatus = await runCli({
      args: ["auth", "status", "--profile", "prod", "--json"],
      configHome,
    });
    expect(prodStatus.exitCode, prodStatus.stderr).toBe(0);
    expect(parseJson(prodStatus.stdout, AuthStatus)).toEqual({
      profile: "prod",
      present: false,
      url: null,
    });

    const stagingStatus = await runCli({
      args: ["auth", "status", "--profile", "staging", "--json"],
      configHome,
    });
    expect(stagingStatus.exitCode, stagingStatus.stderr).toBe(0);
    expect(parseJson(stagingStatus.stdout, AuthStatus)).toEqual({
      profile: "staging",
      present: true,
      url: bootstrap.baseUrl,
    });
  });

  it("METABASE_PROFILE env var selects the active profile when no --profile flag is passed", async () => {
    const configHome = await makeIsolatedConfigHome();
    await loginProfile(configHome, "prod");

    const status = await runCli({
      args: ["auth", "status", "--json"],
      configHome,
      env: { METABASE_PROFILE: "prod" },
    });
    expect(status.exitCode, status.stderr).toBe(0);
    expect(parseJson(status.stdout, AuthStatus)).toEqual({
      profile: "prod",
      present: true,
      url: bootstrap.baseUrl,
    });
  });

  it("--profile flag wins over METABASE_PROFILE env var", async () => {
    const configHome = await makeIsolatedConfigHome();
    await loginProfile(configHome, "staging");

    const status = await runCli({
      args: ["auth", "status", "--profile", "staging", "--json"],
      configHome,
      env: { METABASE_PROFILE: "does-not-exist" },
    });
    expect(status.exitCode, status.stderr).toBe(0);
    expect(parseJson(status.stdout, AuthStatus)).toEqual({
      profile: "staging",
      present: true,
      url: bootstrap.baseUrl,
    });
  });

  it("db list authenticates using stored credentials for the named profile", async () => {
    const configHome = await makeIsolatedConfigHome();
    await loginProfile(configHome, "staging");

    const result = await runCli({
      args: ["db", "list", "--profile", "staging", "--json"],
      configHome,
    });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, DatabaseListEnvelope)).toEqual({
      data: [{ id: E2E_DATABASES.WAREHOUSE, name: "Warehouse", engine: "postgres" }],
      returned: 1,
      total: 1,
    });
  });

  it("running a card query on the same instance succeeds for the admin profile but is forbidden for the limited profile", async () => {
    const configHome = await makeIsolatedConfigHome();
    await loginProfile(configHome, "admin", {
      apiKey: bootstrap.adminApiKey,
      email: bootstrap.adminApiKeyEmail,
    });
    await loginProfile(configHome, "limited", {
      apiKey: bootstrap.limitedApiKey,
      email: bootstrap.limitedApiKeyEmail,
    });

    const adminQuery = await runCli({
      args: ["card", "query", String(E2E_CARDS.ORDERS_BY_STATUS), "--profile", "admin", "--json"],
      configHome,
    });
    expect(adminQuery.exitCode, adminQuery.stderr).toBe(0);
    const adminPayload = parseJson(adminQuery.stdout, CardQueryResult);
    expect(adminPayload.status).toBe("completed");

    const limitedQuery = await runCli({
      args: ["card", "query", String(E2E_CARDS.ORDERS_BY_STATUS), "--profile", "limited", "--json"],
      configHome,
    });
    expect(limitedQuery.exitCode).toBe(1);
    expect(limitedQuery.stderr).toContain("Invalid or unauthorized API key");
    expect(limitedQuery.stdout).toBe("");
  });

  it("db list --profile pointing at an unknown profile fails with ConfigError", async () => {
    const configHome = await makeIsolatedConfigHome();

    const result = await runCli({
      args: ["db", "list", "--profile", "nonexistent", "--json"],
      configHome,
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('Not authenticated for profile "nonexistent"');
    expect(result.stdout).toBe("");
  });
});
