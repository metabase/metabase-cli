import { join } from "node:path";
import { promises as fs } from "node:fs";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { LoginResult } from "../../src/commands/auth/login";
import { AuthProfileListEnvelope } from "../../src/commands/auth/list";
import { LogoutResult } from "../../src/commands/auth/logout";
import { AuthStatus } from "../../src/commands/auth/status";
import { ProfilesFile } from "../../src/core/auth/profile-record";
import { parseJson } from "../../src/runtime/json";

import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";

const BAD_API_KEY = "mb_definitely_not_valid_key_aaaaaaaaaa";

function profilesPath(configHome: string): string {
  return join(configHome, "metabase-cli", "profiles.json");
}

async function readProfilesJson(configHome: string): Promise<ProfilesFile> {
  const raw = await fs.readFile(profilesPath(configHome), "utf8");
  return parseJson(raw, ProfilesFile, { source: profilesPath(configHome) });
}

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

  it("login verifies the admin key, persists lastProbe on disk, and status reflects it", async () => {
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

    const loginPayload = parseJson(login.stdout, LoginResult);
    expect(loginPayload.profile).toBe("default");
    expect(loginPayload.url).toBe(bootstrap.baseUrl);
    expect(loginPayload.authenticated).toBe(true);
    expect(loginPayload.user?.id).toBeGreaterThan(0);
    expect(loginPayload.user?.name).not.toBe("");
    expect(loginPayload.version?.tag.startsWith("v")).toBe(true);
    expect(["oss", "ee"]).toContain(loginPayload.edition);

    const fileAfterLogin = await readProfilesJson(configHome);
    expect(fileAfterLogin.profiles).toHaveLength(1);
    const stored = fileAfterLogin.profiles[0];
    expect(stored?.name).toBe("default");
    expect(stored?.url).toBe(bootstrap.baseUrl);
    expect(stored?.lastProbe?.version.tag).toBe(loginPayload.version?.tag);
    expect(stored?.lastFailure).toBeNull();

    const status = await runCli({ args: ["auth", "status", "--json"], configHome });
    expect(status.exitCode, status.stderr).toBe(0);
    expect(status.stdout).not.toContain(bootstrap.adminApiKey);
    const statusPayload = parseJson(status.stdout, AuthStatus);
    expect(statusPayload.profile).toBe("default");
    expect(statusPayload.present).toBe(true);
    expect(statusPayload.url).toBe(bootstrap.baseUrl);
    expect(statusPayload.user?.id).toBe(loginPayload.user?.id);
    expect(statusPayload.version?.tag).toBe(loginPayload.version?.tag);
    expect(statusPayload.lastFailure).toBeNull();
  });

  it("first-time login with an invalid api key fails verification and leaves profiles.json untouched", async () => {
    const configHome = await makeIsolatedConfigHome();

    const login = await runCli({
      args: [
        "auth",
        "login",
        "--url",
        bootstrap.baseUrl,
        "--api-key",
        BAD_API_KEY,
        "--profile",
        "first_attempt",
        "--json",
      ],
      configHome,
    });

    expect(login.exitCode).toBe(2);
    expect(login.stderr).toContain("verification failed");
    expect(login.stderr).toContain("Invalid or unauthorized API key");
    expect(login.stderr).toContain('credentials were not saved for profile "first_attempt"');

    await expect(fs.access(profilesPath(configHome))).rejects.toThrow();

    const status = await runCli({
      args: ["auth", "status", "--profile", "first_attempt", "--json"],
      configHome,
    });
    expect(status.exitCode, status.stderr).toBe(0);
    const statusPayload = parseJson(status.stdout, AuthStatus);
    expect(statusPayload.profile).toBe("first_attempt");
    expect(statusPayload.present).toBe(false);
  });

  it("re-login failure preserves prior lastProbe/url/apiKey but writes lastFailure", async () => {
    const configHome = await makeIsolatedConfigHome();

    const first = await runCli({
      args: [
        "auth",
        "login",
        "--url",
        bootstrap.baseUrl,
        "--api-key",
        bootstrap.adminApiKey,
        "--profile",
        "stable",
        "--json",
      ],
      configHome,
    });
    expect(first.exitCode, first.stderr).toBe(0);
    const before = await readProfilesJson(configHome);
    const beforeStable = before.profiles.find((entry) => entry.name === "stable");
    expect(beforeStable?.lastProbe).not.toBeNull();
    expect(beforeStable?.lastFailure).toBeNull();

    const second = await runCli({
      args: [
        "auth",
        "login",
        "--url",
        bootstrap.baseUrl,
        "--api-key",
        BAD_API_KEY,
        "--profile",
        "stable",
        "--json",
      ],
      configHome,
    });
    expect(second.exitCode).toBe(2);

    const after = await readProfilesJson(configHome);
    const afterStable = after.profiles.find((entry) => entry.name === "stable");
    expect(afterStable?.url).toBe(beforeStable?.url);
    expect(afterStable?.apiKey).toBe(beforeStable?.apiKey);
    expect(afterStable?.lastProbe).toEqual(beforeStable?.lastProbe);
    expect(afterStable?.lastFailure?.kind).toBe("auth");
    expect(afterStable?.lastFailure?.reason).toContain("Invalid or unauthorized API key");
  });

  it("auth list refreshes a stored profile and writes the new lastProbe to disk", async () => {
    const configHome = await makeIsolatedConfigHome();

    const login = await runCli({
      args: [
        "auth",
        "login",
        "--url",
        bootstrap.baseUrl,
        "--api-key",
        bootstrap.adminApiKey,
        "--profile",
        "refreshable",
        "--skip-verify",
        "--json",
      ],
      configHome,
    });
    expect(login.exitCode, login.stderr).toBe(0);

    const before = await readProfilesJson(configHome);
    expect(before.profiles[0]?.lastProbe).toBeNull();

    const list = await runCli({ args: ["auth", "list", "--json"], configHome });
    expect(list.exitCode, list.stderr).toBe(0);

    const envelope = parseJson(list.stdout, AuthProfileListEnvelope);
    expect(envelope.returned).toBe(1);
    expect(envelope.data[0]?.status).toBe("ok");
    expect(envelope.data[0]?.version?.tag.startsWith("v")).toBe(true);

    const after = await readProfilesJson(configHome);
    expect(after.profiles[0]?.lastProbe).not.toBeNull();
    expect(after.profiles[0]?.lastProbe?.version.tag).toBe(envelope.data[0]?.version?.tag);
  });

  it("auth list against an unreachable URL surfaces the failure but keeps cached lastProbe", async () => {
    const configHome = await makeIsolatedConfigHome();

    await runCli({
      args: [
        "auth",
        "login",
        "--url",
        bootstrap.baseUrl,
        "--api-key",
        bootstrap.adminApiKey,
        "--profile",
        "stable",
        "--json",
      ],
      configHome,
    });
    const before = await readProfilesJson(configHome);
    const beforeProbe = before.profiles[0]?.lastProbe;
    expect(beforeProbe).not.toBeNull();

    const path = profilesPath(configHome);
    const raw = await fs.readFile(path, "utf8");
    const file = parseJson(raw, ProfilesFile, { source: path });
    const brokenProfiles = file.profiles.map((entry) => {
      const copy = { ...entry };
      copy.url = "https://127.0.0.1:1/__nonexistent__";
      return copy;
    });
    const broken: ProfilesFile = { ...file, profiles: brokenProfiles };
    await fs.writeFile(path, JSON.stringify(broken, null, 2) + "\n");

    const list = await runCli({ args: ["auth", "list", "--json"], configHome });
    expect(list.exitCode, list.stderr).toBe(0);
    expect(list.stderr).toContain("stable:");

    const envelope = parseJson(list.stdout, AuthProfileListEnvelope);
    expect(envelope.data[0]?.status).not.toBe("ok");

    const after = await readProfilesJson(configHome);
    expect(after.profiles[0]?.lastProbe).toEqual(beforeProbe);
    expect(after.profiles[0]?.lastFailure).not.toBeNull();
  });

  it("a successful re-login clears a prior lastFailure for the same profile", async () => {
    const configHome = await makeIsolatedConfigHome();

    const first = await runCli({
      args: [
        "auth",
        "login",
        "--url",
        bootstrap.baseUrl,
        "--api-key",
        bootstrap.adminApiKey,
        "--profile",
        "recovers",
        "--json",
      ],
      configHome,
    });
    expect(first.exitCode, first.stderr).toBe(0);

    const failed = await runCli({
      args: [
        "auth",
        "login",
        "--url",
        bootstrap.baseUrl,
        "--api-key",
        BAD_API_KEY,
        "--profile",
        "recovers",
        "--json",
      ],
      configHome,
    });
    expect(failed.exitCode).toBe(2);
    const afterFailure = await readProfilesJson(configHome);
    expect(afterFailure.profiles[0]?.lastFailure).not.toBeNull();

    const recovered = await runCli({
      args: [
        "auth",
        "login",
        "--url",
        bootstrap.baseUrl,
        "--api-key",
        bootstrap.adminApiKey,
        "--profile",
        "recovers",
        "--json",
      ],
      configHome,
    });
    expect(recovered.exitCode, recovered.stderr).toBe(0);

    const after = await readProfilesJson(configHome);
    expect(after.profiles[0]?.lastFailure).toBeNull();
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

    const logout = await runCli({ args: ["auth", "logout", "--yes", "--json"], configHome });
    expect(logout.exitCode, logout.stderr).toBe(0);
    expect(logout.stderr).not.toContain(bootstrap.adminApiKey);
    expect(parseJson(logout.stdout, LogoutResult)).toEqual({
      profile: "default",
      cleared: true,
      aborted: false,
    });

    const status = await runCli({ args: ["auth", "status", "--json"], configHome });
    expect(status.exitCode, status.stderr).toBe(0);
    const statusPayload = parseJson(status.stdout, AuthStatus);
    expect(statusPayload.profile).toBe("default");
    expect(statusPayload.present).toBe(false);
    expect(statusPayload.url).toBeNull();
  });

  it("logout reports cleared:false when no credentials are stored for the profile", async () => {
    const configHome = await makeIsolatedConfigHome();

    const logout = await runCli({ args: ["auth", "logout", "--yes", "--json"], configHome });

    expect(logout.exitCode, logout.stderr).toBe(0);
    expect(parseJson(logout.stdout, LogoutResult)).toEqual({
      profile: "default",
      cleared: false,
      aborted: false,
    });
  });

  it("login routes through METABASE_PROFILE when no --profile flag is passed", async () => {
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
      env: { METABASE_PROFILE: "env_routed" },
    });

    expect(login.exitCode, login.stderr).toBe(0);
    const payload = parseJson(login.stdout, LoginResult);
    expect(payload.profile).toBe("env_routed");
    expect(payload.url).toBe(bootstrap.baseUrl);
    expect(payload.authenticated).toBe(true);

    const defaultStatus = await runCli({ args: ["auth", "status", "--json"], configHome });
    expect(defaultStatus.exitCode, defaultStatus.stderr).toBe(0);
    const defaultPayload = parseJson(defaultStatus.stdout, AuthStatus);
    expect(defaultPayload.present).toBe(false);

    const envStatus = await runCli({
      args: ["auth", "status", "--json"],
      configHome,
      env: { METABASE_PROFILE: "env_routed" },
    });
    expect(envStatus.exitCode, envStatus.stderr).toBe(0);
    const envPayload = parseJson(envStatus.stdout, AuthStatus);
    expect(envPayload.profile).toBe("env_routed");
    expect(envPayload.present).toBe(true);
  });

  it("logout proceeds without --yes when stdin is not a TTY (non-interactive auto-confirm)", async () => {
    const configHome = await makeIsolatedConfigHome();

    const logout = await runCli({ args: ["auth", "logout", "--json"], configHome, stdin: "" });

    expect(logout.exitCode, logout.stderr).toBe(0);
    expect(parseJson(logout.stdout, LogoutResult)).toEqual({
      profile: "default",
      cleared: false,
      aborted: false,
    });
  });
});
