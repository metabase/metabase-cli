import { describe, expect, it } from "vitest";

import { createFakeClient, type FakeClientCall } from "../http/fake-client";

import {
  createServerInfoCache,
  EMPTY_SERVER_INFO,
  probeServer,
  PROBE_PATH,
  PROBE_TIMEOUT_MS,
} from "./probe";

const EXPECTED_PROBE_CALL: FakeClientCall = {
  path: PROBE_PATH,
  options: { timeoutMs: PROBE_TIMEOUT_MS, retries: 0 },
};

function planning(response: unknown): ReadonlyMap<string, unknown> {
  return new Map([[PROBE_PATH, response]]);
}

function failingWith(error: Error): ReadonlyMap<string, Error> {
  return new Map([[PROBE_PATH, error]]);
}

describe("probeServer", () => {
  it("returns parsed ServerInfo on a successful EE-enterprise response", async () => {
    const { client } = createFakeClient({
      responses: planning({
        version: { tag: "v1.58.7", date: "2025-12-15", hash: "abc1234" },
        "token-features": { advanced_permissions: true, audit_app: true, embedding: true },
      }),
    });
    expect(await probeServer(client)).toEqual({
      version: { tag: "v1.58.7", build: "ee", major: 58, patch: 7 },
      edition: "enterprise",
      tokenFeatures: { advanced_permissions: true, audit_app: true, embedding: true },
    });
  });

  it("queries the probe endpoint with retries disabled and a short timeout", async () => {
    const { client, calls } = createFakeClient({
      responses: planning({ version: { tag: "v0.58.7" } }),
    });
    await probeServer(client);
    expect(calls).toEqual([EXPECTED_PROBE_CALL]);
  });

  it("classifies an EE-build response with all token-features false as oss", async () => {
    const { client } = createFakeClient({
      responses: planning({
        version: { tag: "v1.58.7" },
        "token-features": { advanced_permissions: false, embedding: false },
      }),
    });
    expect(await probeServer(client)).toEqual({
      version: { tag: "v1.58.7", build: "ee", major: 58, patch: 7 },
      edition: "oss",
      tokenFeatures: { advanced_permissions: false, embedding: false },
    });
  });

  it("returns tokenFeatures: null when the server omits the field", async () => {
    const { client } = createFakeClient({
      responses: planning({ version: { tag: "v0.58.7" } }),
    });
    expect(await probeServer(client)).toEqual({
      version: { tag: "v0.58.7", build: "oss", major: 58, patch: 7 },
      edition: "oss",
      tokenFeatures: null,
    });
  });
});

describe("createServerInfoCache", () => {
  it("probes once even when called many times concurrently", async () => {
    const { client, calls } = createFakeClient({
      responses: planning({ version: { tag: "v0.58.7" }, "token-features": {} }),
    });
    const getInfo = createServerInfoCache(async () => client);
    const [a, b, c] = await Promise.all([getInfo(), getInfo(), getInfo()]);
    expect(calls).toEqual([EXPECTED_PROBE_CALL]);
    expect(a).toBe(b);
    expect(a).toBe(c);
  });

  it("returns the EMPTY_SERVER_INFO sentinel when the probe rejects", async () => {
    const { client } = createFakeClient({ errors: failingWith(new Error("boom")) });
    const getInfo = createServerInfoCache(async () => client);
    expect(await getInfo()).toBe(EMPTY_SERVER_INFO);
  });

  it("caches the failure so transient errors do not re-probe per call", async () => {
    const { client, calls } = createFakeClient({ errors: failingWith(new Error("boom")) });
    const getInfo = createServerInfoCache(async () => client);
    await getInfo();
    await getInfo();
    expect(calls).toEqual([EXPECTED_PROBE_CALL]);
  });
});
