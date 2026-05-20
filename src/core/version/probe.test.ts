import { describe, expect, it } from "vitest";

import { createFakeClient, type FakeClientCall } from "../http/fake-client";

import { probeServer, PROBE_PATH, PROBE_TIMEOUT_MS } from "./probe";

const EXPECTED_PROBE_CALL: FakeClientCall = {
  path: PROBE_PATH,
  options: { timeoutMs: PROBE_TIMEOUT_MS, retries: 0 },
};

function planning(response: unknown): ReadonlyMap<string, unknown> {
  return new Map([[PROBE_PATH, response]]);
}

describe("probeServer", () => {
  it("returns parsed ServerInfo on a successful EE response", async () => {
    const { client } = createFakeClient({
      responses: planning({
        version: { tag: "v1.58.7", date: "2025-12-15", hash: "abc1234" },
        "token-features": { advanced_permissions: true, audit_app: true, embedding: true },
      }),
    });
    expect(await probeServer(client)).toEqual({
      version: { tag: "v1.58.7", build: "ee", major: 58, patch: 7 },
      edition: "ee",
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

  it("derives edition from the build, not token-features (EE build stays ee even with all features false)", async () => {
    const { client } = createFakeClient({
      responses: planning({
        version: { tag: "v1.58.7" },
        "token-features": { advanced_permissions: false, embedding: false },
      }),
    });
    expect(await probeServer(client)).toEqual({
      version: { tag: "v1.58.7", build: "ee", major: 58, patch: 7 },
      edition: "ee",
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
