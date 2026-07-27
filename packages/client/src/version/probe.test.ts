import { describe, expect, it } from "vitest";

import { createFakeClient, type FakeClientCall, type FakeClientPlan } from "../testing/fake-client";

import { probeServer, PROBE_PATH, PROBE_TIMEOUT_MS } from "./probe";

const EXPECTED_PROBE_CALL: FakeClientCall = {
  method: "GET",
  path: PROBE_PATH,
  options: { timeoutMs: PROBE_TIMEOUT_MS, retries: 0 },
};

function planning(response: unknown): FakeClientPlan {
  return { routes: [{ path: PROBE_PATH, reply: { kind: "body", body: response } }] };
}

describe("probeServer", () => {
  it("parses the version tag and passes token-features through", async () => {
    const { client } = createFakeClient(
      planning({
        version: { tag: "v1.58.7", date: "2025-12-15", hash: "abc1234" },
        "token-features": { advanced_permissions: true, audit_app: true, embedding: true },
      }),
    );
    expect(await probeServer(client)).toEqual({
      version: { tag: "v1.58.7", major: 58, patch: 7 },
      tokenFeatures: { advanced_permissions: true, audit_app: true, embedding: true },
    });
  });

  it("queries the probe endpoint with retries disabled and a short timeout", async () => {
    const { client, calls } = createFakeClient(planning({ version: { tag: "v0.58.7" } }));
    await probeServer(client);
    expect(calls).toEqual([EXPECTED_PROBE_CALL]);
  });

  it("returns tokenFeatures: null when the server omits the field", async () => {
    const { client } = createFakeClient(planning({ version: { tag: "v0.58.7" } }));
    expect(await probeServer(client)).toEqual({
      version: { tag: "v0.58.7", major: 58, patch: 7 },
      tokenFeatures: null,
    });
  });

  it("returns version null for an unparseable head/nightly tag, token-features still passed through", async () => {
    const { client } = createFakeClient(
      planning({
        version: { tag: "vUNKNOWN" },
        "token-features": { transforms: true },
      }),
    );
    expect(await probeServer(client)).toEqual({
      version: null,
      tokenFeatures: { transforms: true },
    });
  });
});
