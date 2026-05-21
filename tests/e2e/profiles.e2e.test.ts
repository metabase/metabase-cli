import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { AuthProfileListEnvelope } from "../../src/commands/auth/list";
import { LoginResult } from "../../src/commands/auth/login";
import { LogoutResult } from "../../src/commands/auth/logout";
import { AuthStatus } from "../../src/commands/auth/status";
import { DatabaseListEnvelope } from "../../src/commands/db/list";
import { CardQueryResult } from "../../src/domain/card";
import { parseJson } from "../../src/runtime/json";

import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";
import { SEEDED } from "./seed/seeded";
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

  async function loginProfile(
    configHome: string,
    profile: string,
    apiKey: string = bootstrap.adminApiKey,
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
        apiKey,
        "--json",
      ],
      configHome,
    });
    expect(login.exitCode, login.stderr).toBe(0);
    const payload = parseJson(login.stdout, LoginResult);
    expect(payload.profile).toBe(profile);
    expect(payload.url).toBe(bootstrap.baseUrl);
    expect(payload.authenticated).toBe(true);
  }

  it("login --profile stores credentials only under that profile", async () => {
    const configHome = await makeIsolatedConfigHome();
    await loginProfile(configHome, "staging");

    const stagingStatus = await runCli({
      args: ["auth", "status", "--profile", "staging", "--json"],
      configHome,
    });
    expect(stagingStatus.exitCode, stagingStatus.stderr).toBe(0);
    const stagingPayload = parseJson(stagingStatus.stdout, AuthStatus);
    expect(stagingPayload.profile).toBe("staging");
    expect(stagingPayload.present).toBe(true);
    expect(stagingPayload.url).toBe(bootstrap.baseUrl);

    const defaultStatus = await runCli({
      args: ["auth", "status", "--json"],
      configHome,
    });
    expect(defaultStatus.exitCode, defaultStatus.stderr).toBe(0);
    const defaultPayload = parseJson(defaultStatus.stdout, AuthStatus);
    expect(defaultPayload.profile).toBe("default");
    expect(defaultPayload.present).toBe(false);
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
    expect(parseJson(prodStatus.stdout, AuthStatus).present).toBe(false);

    const stagingStatus = await runCli({
      args: ["auth", "status", "--profile", "staging", "--json"],
      configHome,
    });
    expect(stagingStatus.exitCode, stagingStatus.stderr).toBe(0);
    expect(parseJson(stagingStatus.stdout, AuthStatus).present).toBe(true);
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
    const payload = parseJson(status.stdout, AuthStatus);
    expect(payload.profile).toBe("prod");
    expect(payload.present).toBe(true);
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
    const payload = parseJson(status.stdout, AuthStatus);
    expect(payload.profile).toBe("staging");
    expect(payload.present).toBe(true);
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
      data: [{ id: SEEDED.warehouseDbId, name: "Warehouse", engine: "postgres" }],
      returned: 1,
      total: 1,
    });
  });

  it("running a card query on the same instance succeeds for the admin profile but is forbidden for the limited profile", async () => {
    const configHome = await makeIsolatedConfigHome();
    await loginProfile(configHome, "admin", bootstrap.adminApiKey);
    await loginProfile(configHome, "limited", bootstrap.limitedApiKey);

    const adminQuery = await runCli({
      args: ["card", "query", String(SEEDED.ordersCardId), "--profile", "admin", "--json"],
      configHome,
    });
    expect(adminQuery.exitCode, adminQuery.stderr).toBe(0);
    const adminPayload = parseJson(adminQuery.stdout, CardQueryResult);
    expect(adminPayload.status).toBe("completed");

    const limitedQuery = await runCli({
      args: ["card", "query", String(SEEDED.ordersCardId), "--profile", "limited", "--json"],
      configHome,
    });
    expect(limitedQuery.exitCode).toBe(1);
    expect(limitedQuery.stderr).toContain("Invalid or unauthorized API key");
    expect(limitedQuery.stdout).toBe("");
  });

  it("auth list returns empty when no profiles are stored", async () => {
    const configHome = await makeIsolatedConfigHome();

    const result = await runCli({
      args: ["auth", "list", "--json"],
      configHome,
    });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseJson(result.stdout, AuthProfileListEnvelope)).toEqual({
      data: [],
      returned: 0,
      total: 0,
    });
  });

  it("auth list reflects login and logout activity for the same config home", async () => {
    const configHome = await makeIsolatedConfigHome();
    await loginProfile(configHome, "staging");
    await loginProfile(configHome, "prod");

    const afterLogin = await runCli({
      args: ["auth", "list", "--json"],
      configHome,
    });
    expect(afterLogin.exitCode, afterLogin.stderr).toBe(0);
    const afterLoginEnvelope = parseJson(afterLogin.stdout, AuthProfileListEnvelope);
    expect(afterLoginEnvelope.returned).toBe(2);
    expect(afterLoginEnvelope.data.map((entry) => entry.profile).toSorted()).toEqual([
      "prod",
      "staging",
    ]);
    for (const entry of afterLoginEnvelope.data) {
      expect(entry.status).toBe("ok");
      expect(entry.url).toBe(bootstrap.baseUrl);
    }

    await runCli({
      args: ["auth", "logout", "--profile", "prod", "--yes", "--json"],
      configHome,
    });

    const afterLogout = await runCli({
      args: ["auth", "list", "--json"],
      configHome,
    });
    expect(afterLogout.exitCode, afterLogout.stderr).toBe(0);
    const afterLogoutEnvelope = parseJson(afterLogout.stdout, AuthProfileListEnvelope);
    expect(afterLogoutEnvelope.returned).toBe(1);
    expect(afterLogoutEnvelope.data[0]?.profile).toBe("staging");
    expect(afterLogoutEnvelope.data[0]?.status).toBe("ok");
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
