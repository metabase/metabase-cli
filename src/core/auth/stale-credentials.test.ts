import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ProfileRecord } from "./profile-record";
import { describeStaleCredential, findStaleParentCredentials } from "./stale-credentials";

const PARENT_URL = "https://parent.example.com";

function apiKeyRecord(name: string, url: string): ProfileRecord {
  return { name, url, apiKey: "mb_stale_key", oauth: null, lastProbe: null, lastFailure: null };
}

function oauthRecord(name: string, url: string, scope: string): ProfileRecord {
  return {
    name,
    url,
    apiKey: null,
    oauth: {
      accessToken: "acc",
      refreshToken: "ref",
      expiresAt: "2099-01-01T00:00:00.000Z",
      clientId: "c1",
      scope,
    },
    lastProbe: null,
    lastFailure: null,
  };
}

describe("findStaleParentCredentials", () => {
  beforeEach(() => {
    process.env["MB_CLI_DISABLE_KEYRING"] = "1";
  });

  afterEach(() => {
    delete process.env["MB_CLI_DISABLE_KEYRING"];
  });

  it("flags a full-scope OAuth profile and an api-key profile for the same server", () => {
    const records = [
      oauthRecord("old-login", PARENT_URL, "mb:full"),
      apiKeyRecord("ci-admin", PARENT_URL),
    ];
    expect(findStaleParentCredentials(records, PARENT_URL, "agent")).toEqual([
      { profile: "old-login", kind: "oauth", scope: "mb:full" },
      { profile: "ci-admin", kind: "apiKey" },
    ]);
  });

  it("does not flag a workspace-scoped OAuth profile", () => {
    const records = [oauthRecord("agent-safe", PARENT_URL, "mb:workspace-manager")];
    expect(findStaleParentCredentials(records, PARENT_URL, "agent")).toEqual([]);
  });

  it("ignores credentials for a different server", () => {
    const records = [
      apiKeyRecord("other-host", "https://other.example.com"),
      oauthRecord("other-login", "https://other.example.com", "mb:full"),
    ];
    expect(findStaleParentCredentials(records, PARENT_URL, "agent")).toEqual([]);
  });

  it("matches the same server across trailing-slash differences", () => {
    const records = [apiKeyRecord("slashed", `${PARENT_URL}/`)];
    expect(findStaleParentCredentials(records, PARENT_URL, "agent")).toEqual([
      { profile: "slashed", kind: "apiKey" },
    ]);
  });

  it("exempts the profile the command runs as", () => {
    const records = [apiKeyRecord("agent", PARENT_URL)];
    expect(findStaleParentCredentials(records, PARENT_URL, "agent")).toEqual([]);
  });

  it("ignores a record whose credential was already cleared", () => {
    const cleared: ProfileRecord = {
      name: "logged-out",
      url: PARENT_URL,
      apiKey: null,
      oauth: null,
      lastProbe: null,
      lastFailure: null,
    };
    expect(findStaleParentCredentials([cleared], PARENT_URL, "agent")).toEqual([]);
  });
});

describe("describeStaleCredential", () => {
  it("names an api-key offender", () => {
    expect(describeStaleCredential({ profile: "ci-admin", kind: "apiKey" })).toBe(
      "ci-admin (api key)",
    );
  });

  it("names an oauth offender with its scope", () => {
    expect(describeStaleCredential({ profile: "old-login", kind: "oauth", scope: "mb:full" })).toBe(
      "old-login (mb:full)",
    );
  });
});
