import { promises as fs } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { z } from "zod";

import { isFileNotFoundError } from "@metabase/client/errors";
import { parseJson } from "@metabase/client/json";

import { LoginResult } from "../../packages/cli/src/commands/auth/login";
import { AuthProfileListEnvelope } from "../../packages/cli/src/commands/auth/list";
import { LogoutResult } from "../../packages/cli/src/commands/auth/logout";
import { AuthStatus } from "../../packages/cli/src/commands/auth/status";
import {
  type ProbedUser,
  type ProfileLastFailure,
  type ProfileLastProbe,
  type ProfileRecord,
  ProfilesFile,
} from "../../packages/cli/src/core/auth/profile-record";
import { summarizeServer } from "../../packages/cli/src/core/auth/server-summary";
import { readBootstrap, type E2EBootstrap } from "./bootstrap-data";
import { cleanupConfigHome, mkTempConfigHome, runCli } from "./run-cli";
import { cliErrorMessage } from "./cli-error";

type AuthProfileEntry = z.infer<typeof AuthProfileListEnvelope>["data"][number];

const BAD_API_KEY = "mb_definitely_not_valid_key_aaaaaaaaaa";
const UNREACHABLE_URL = "https://127.0.0.1:1/__nonexistent__";
// Port 1 is on fetch's blocked-port list, so the failure carries no syscall code to hint from.
const UNREACHABLE_REASON = "Could not reach Metabase: fetch failed";

function profilesPath(configHome: string): string {
  return join(configHome, "metabase-cli", "profiles.json");
}

async function readProfilesJson(configHome: string): Promise<ProfilesFile> {
  const raw = await fs.readFile(profilesPath(configHome), "utf8");
  return parseJson(raw, ProfilesFile, { source: profilesPath(configHome) });
}

// The one record a fresh config home holds after a single login.
function onlyRecord(file: ProfilesFile): ProfileRecord {
  const [record, ...rest] = file.profiles;
  if (record === undefined || rest.length > 0) {
    throw new Error(`expected exactly one profile record, got ${file.profiles.length}`);
  }
  return record;
}

function onlyEntry(envelope: z.infer<typeof AuthProfileListEnvelope>): AuthProfileEntry {
  const [entry, ...rest] = envelope.data;
  if (entry === undefined || rest.length > 0) {
    throw new Error(`expected exactly one listed profile, got ${envelope.data.length}`);
  }
  return entry;
}

function probeOf(record: ProfileRecord): ProfileLastProbe {
  if (record.lastProbe === null) {
    throw new Error(`profile "${record.name}" holds no probe`);
  }
  return record.lastProbe;
}

function failureOf(record: ProfileRecord): ProfileLastFailure {
  if (record.lastFailure === null) {
    throw new Error(`profile "${record.name}" holds no failure`);
  }
  return record.lastFailure;
}

function userOf(payload: { user: ProbedUser | null }): ProbedUser {
  if (payload.user === null) {
    throw new Error("expected a probed user");
  }
  return payload.user;
}

function timestampOf(value: string | null): string {
  if (value === null) {
    throw new Error("expected a probe timestamp");
  }
  return value;
}

// The record `auth login` leaves for the admin key: the key inline (the harness disables the
// keyring) and the bootstrap's own server facts. The probe's timestamp is the one value only the
// CLI knows, so the caller reads it off the record it is about to compare.
function probedRecord(
  name: string,
  bootstrap: E2EBootstrap,
  user: ProbedUser,
  probedAt: string,
): ProfileRecord {
  return {
    name,
    url: bootstrap.baseUrl,
    apiKey: bootstrap.adminApiKey,
    oauth: null,
    lastProbe: {
      at: probedAt,
      version: bootstrap.server.version,
      edition: bootstrap.server.edition,
      date: bootstrap.server.date,
      hash: bootstrap.server.hash,
      tokenFeatures: bootstrap.server.tokenFeatures,
      user,
    },
    lastFailure: null,
  };
}

function invalidKeyReason(bootstrap: E2EBootstrap): string {
  return `Invalid or unauthorized API key (host: ${new URL(bootstrap.baseUrl).host}).`;
}

function absentStatus(profile: string): z.infer<typeof AuthStatus> {
  return {
    profile,
    present: false,
    url: null,
    method: null,
    user: null,
    ...summarizeServer(null),
    lastProbedAt: null,
    lastFailure: null,
  };
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
    // The API key's own user is minted by the bootstrap and named after the key, so only its role
    // is pinned here; the same user must then come back from every read of the profile.
    const adminUser = userOf(loginPayload);
    expect(adminUser.isAdmin).toBe(true);
    expect(loginPayload).toEqual({
      profile: "default",
      url: bootstrap.baseUrl,
      authenticated: true,
      user: adminUser,
      ...summarizeServer(bootstrap.server),
    });

    const stored = onlyRecord(await readProfilesJson(configHome));
    const probedAt = probeOf(stored).at;
    expect(stored).toEqual(probedRecord("default", bootstrap, adminUser, probedAt));

    const status = await runCli({ args: ["auth", "status", "--json"], configHome });
    expect(status.exitCode, status.stderr).toBe(0);
    expect(status.stdout).not.toContain(bootstrap.adminApiKey);
    expect(parseJson(status.stdout, AuthStatus)).toEqual({
      profile: "default",
      present: true,
      url: bootstrap.baseUrl,
      method: "apiKey",
      user: adminUser,
      ...summarizeServer(bootstrap.server),
      lastProbedAt: probedAt,
      lastFailure: null,
    });

    const list = await runCli({ args: ["auth", "list", "--json"], configHome });
    expect(list.exitCode, list.stderr).toBe(0);
    const envelope = parseJson(list.stdout, AuthProfileListEnvelope);
    const reprobedAt = timestampOf(onlyEntry(envelope).lastProbedAt);
    expect(envelope).toEqual({
      data: [
        {
          profile: "default",
          url: bootstrap.baseUrl,
          method: "apiKey",
          authenticated: true,
          status: "ok",
          user: adminUser,
          ...summarizeServer(bootstrap.server),
          lastProbedAt: reprobedAt,
          lastFailure: null,
        },
      ],
      returned: 1,
      offset: 0,
      total: 1,
      has_more: false,
      next_offset: null,
    });
    expect(reprobedAt >= probedAt).toBe(true);
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
    expect(cliErrorMessage(login.stderr)).toBe(
      `verification failed (current user, ${bootstrap.baseUrl}/api/user/current): ${invalidKeyReason(bootstrap)} — credentials were not saved for profile "first_attempt"`,
    );

    await expect(fs.access(profilesPath(configHome))).rejects.toSatisfy(isFileNotFoundError);

    const status = await runCli({
      args: ["auth", "status", "--profile", "first_attempt", "--json"],
      configHome,
    });
    expect(status.exitCode, status.stderr).toBe(0);
    expect(parseJson(status.stdout, AuthStatus)).toEqual({
      profile: "first_attempt",
      present: false,
      url: null,
      method: null,
      user: null,
      ...summarizeServer(null),
      lastProbedAt: null,
      lastFailure: null,
    });
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
    const adminUser = userOf(parseJson(first.stdout, LoginResult));
    const beforeStable = onlyRecord(await readProfilesJson(configHome));
    expect(beforeStable).toEqual(
      probedRecord("stable", bootstrap, adminUser, probeOf(beforeStable).at),
    );

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

    const afterStable = onlyRecord(await readProfilesJson(configHome));
    expect(afterStable).toEqual({
      ...beforeStable,
      lastFailure: {
        at: failureOf(afterStable).at,
        kind: "auth",
        reason: invalidKeyReason(bootstrap),
      },
    });
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

    expect(onlyRecord(await readProfilesJson(configHome))).toEqual({
      name: "refreshable",
      url: bootstrap.baseUrl,
      apiKey: bootstrap.adminApiKey,
      oauth: null,
      lastProbe: null,
      lastFailure: null,
    });

    const list = await runCli({ args: ["auth", "list", "--json"], configHome });
    expect(list.exitCode, list.stderr).toBe(0);

    const envelope = parseJson(list.stdout, AuthProfileListEnvelope);
    const entry = onlyEntry(envelope);
    const adminUser = userOf(entry);
    const probedAt = timestampOf(entry.lastProbedAt);
    expect(envelope).toEqual({
      data: [
        {
          profile: "refreshable",
          url: bootstrap.baseUrl,
          method: "apiKey",
          authenticated: true,
          status: "ok",
          user: adminUser,
          ...summarizeServer(bootstrap.server),
          lastProbedAt: probedAt,
          lastFailure: null,
        },
      ],
      returned: 1,
      offset: 0,
      total: 1,
      has_more: false,
      next_offset: null,
    });

    expect(onlyRecord(await readProfilesJson(configHome))).toEqual(
      probedRecord("refreshable", bootstrap, adminUser, probedAt),
    );
  });

  it("auth list against an unreachable URL surfaces the failure but keeps cached lastProbe", async () => {
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
        "stable",
        "--json",
      ],
      configHome,
    });
    expect(login.exitCode, login.stderr).toBe(0);
    const adminUser = userOf(parseJson(login.stdout, LoginResult));
    const file = await readProfilesJson(configHome);
    const before = onlyRecord(file);
    const beforeProbe = probeOf(before);
    expect(before).toEqual(probedRecord("stable", bootstrap, adminUser, beforeProbe.at));

    const broken: ProfilesFile = { ...file, profiles: [{ ...before, url: UNREACHABLE_URL }] };
    await fs.writeFile(profilesPath(configHome), JSON.stringify(broken, null, 2) + "\n");

    const list = await runCli({ args: ["auth", "list", "--json"], configHome });
    expect(list.exitCode, list.stderr).toBe(0);

    const after = onlyRecord(await readProfilesJson(configHome));
    const failure = { at: failureOf(after).at, kind: "network", reason: UNREACHABLE_REASON };
    expect(parseJson(list.stdout, AuthProfileListEnvelope)).toEqual({
      data: [
        {
          profile: "stable",
          url: UNREACHABLE_URL,
          method: "apiKey",
          authenticated: false,
          status: "network-error",
          user: adminUser,
          ...summarizeServer(bootstrap.server),
          lastProbedAt: beforeProbe.at,
          lastFailure: failure,
        },
      ],
      returned: 1,
      offset: 0,
      total: 1,
      has_more: false,
      next_offset: null,
    });
    expect(after).toEqual({ ...before, url: UNREACHABLE_URL, lastFailure: failure });
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
    const adminUser = userOf(parseJson(first.stdout, LoginResult));
    const initial = onlyRecord(await readProfilesJson(configHome));
    expect(initial).toEqual(probedRecord("recovers", bootstrap, adminUser, probeOf(initial).at));

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
    const afterFailure = onlyRecord(await readProfilesJson(configHome));
    expect(afterFailure).toEqual({
      ...initial,
      lastFailure: {
        at: failureOf(afterFailure).at,
        kind: "auth",
        reason: invalidKeyReason(bootstrap),
      },
    });

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

    const after = onlyRecord(await readProfilesJson(configHome));
    expect(after).toEqual(probedRecord("recovers", bootstrap, adminUser, probeOf(after).at));
    expect(probeOf(after).at >= probeOf(initial).at).toBe(true);
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
    expect(parseJson(status.stdout, AuthStatus)).toEqual(absentStatus("default"));
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

  it("login routes through MB_PROFILE when no --profile flag is passed", async () => {
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
      env: { MB_PROFILE: "env_routed" },
    });

    expect(login.exitCode, login.stderr).toBe(0);
    const payload = parseJson(login.stdout, LoginResult);
    const adminUser = userOf(payload);
    expect(payload).toEqual({
      profile: "env_routed",
      url: bootstrap.baseUrl,
      authenticated: true,
      user: adminUser,
      ...summarizeServer(bootstrap.server),
    });

    const defaultStatus = await runCli({ args: ["auth", "status", "--json"], configHome });
    expect(defaultStatus.exitCode, defaultStatus.stderr).toBe(0);
    expect(parseJson(defaultStatus.stdout, AuthStatus)).toEqual(absentStatus("default"));

    const envStatus = await runCli({
      args: ["auth", "status", "--json"],
      configHome,
      env: { MB_PROFILE: "env_routed" },
    });
    expect(envStatus.exitCode, envStatus.stderr).toBe(0);
    const envPayload = parseJson(envStatus.stdout, AuthStatus);
    expect(envPayload).toEqual({
      profile: "env_routed",
      present: true,
      url: bootstrap.baseUrl,
      method: "apiKey",
      user: adminUser,
      ...summarizeServer(bootstrap.server),
      lastProbedAt: timestampOf(envPayload.lastProbedAt),
      lastFailure: null,
    });
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
