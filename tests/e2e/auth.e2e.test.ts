import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { LoginResult } from "../../src/commands/auth/login";
import { LogoutResult } from "../../src/commands/auth/logout";
import { AuthStatus } from "../../src/commands/auth/status";
import { parseJson } from "../../src/runtime/json";

import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";

describe("auth e2e", () => {
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

  it("login verifies the seeded admin key and status reflects it", async () => {
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

    expect(login.exitCode, login.stderr).toBe(0);
    expect(login.stderr).not.toContain(bootstrap.adminApiKey);
    expect(parseJson(login.stdout, LoginResult)).toEqual({
      profile: "default",
      url: bootstrap.baseUrl,
      authenticated: true,
      email: bootstrap.adminApiKeyEmail,
    });

    const status = await runCli({
      args: ["auth", "status", "--json"],
      configHome,
    });

    expect(status.exitCode, status.stderr).toBe(0);
    expect(status.stdout).not.toContain(bootstrap.adminApiKey);
    expect(parseJson(status.stdout, AuthStatus)).toEqual({
      profile: "default",
      present: true,
      url: bootstrap.baseUrl,
    });
  });

  it("login with an invalid api key fails verification", async () => {
    const configHome = await makeIsolatedConfigHome();

    const login = await runCli({
      args: [
        "auth",
        "login",
        "--url",
        bootstrap.baseUrl,
        "--api-key",
        "mb_definitely_not_valid_key_aaaaaaaaaa",
        "--json",
      ],
      configHome,
    });

    expect(login.exitCode).toBe(2);
    expect(login.stderr).toContain("verification failed: Invalid or unauthorized API key");
  });

  it("logout clears stored credentials and status reflects the cleared profile", async () => {
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
    expect(login.exitCode, login.stderr).toBe(0);

    const logout = await runCli({
      args: ["auth", "logout", "--yes", "--json"],
      configHome,
    });

    expect(logout.exitCode, logout.stderr).toBe(0);
    expect(logout.stderr).not.toContain(bootstrap.adminApiKey);
    expect(parseJson(logout.stdout, LogoutResult)).toEqual({
      profile: "default",
      cleared: true,
      aborted: false,
    });

    const status = await runCli({
      args: ["auth", "status", "--json"],
      configHome,
    });

    expect(status.exitCode, status.stderr).toBe(0);
    expect(parseJson(status.stdout, AuthStatus)).toEqual({
      profile: "default",
      present: false,
      url: null,
    });
  });

  it("logout reports cleared:false when no credentials are stored for the profile", async () => {
    const configHome = await makeIsolatedConfigHome();

    const logout = await runCli({
      args: ["auth", "logout", "--yes", "--json"],
      configHome,
    });

    expect(logout.exitCode, logout.stderr).toBe(0);
    expect(parseJson(logout.stdout, LogoutResult)).toEqual({
      profile: "default",
      cleared: false,
      aborted: false,
    });
  });

  it("logout proceeds without --yes when stdin is not a TTY (non-interactive auto-confirm)", async () => {
    const configHome = await makeIsolatedConfigHome();

    const logout = await runCli({
      args: ["auth", "logout", "--json"],
      configHome,
      stdin: "",
    });

    expect(logout.exitCode, logout.stderr).toBe(0);
    expect(parseJson(logout.stdout, LogoutResult)).toEqual({
      profile: "default",
      cleared: false,
      aborted: false,
    });
  });
});
