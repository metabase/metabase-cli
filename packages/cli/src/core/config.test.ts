import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createClient } from "@metabase/client/client";
import { ConfigError } from "@metabase/client/errors";
import { captureFetch, jsonResponse } from "@metabase/client/testing/fetch-capture";

import { startBrokerFixture, type BrokerFixture } from "./broker-fixture";
import { NO_CREDENTIAL_MESSAGE, resolveConfig } from "./config";

const ENV_NAMES = ["MB_URL", "MB_API_KEY", "MB_AUTH_BROKER", "MB_AUTH_BROKER_TOKEN"] as const;
const SESSION_TOKEN = "session-token-1";
const EXPIRES_AT = "2026-09-22T12:00:00.000Z";
const SIGNAL = new AbortController().signal;

function unauthorizedResponse(): Response {
  return new Response('{"error":"unauthorized"}', {
    status: 401,
    headers: { "content-type": "application/json" },
  });
}

describe("resolveConfig", () => {
  let broker: BrokerFixture | null = null;

  beforeEach(() => {
    for (const name of ENV_NAMES) {
      delete process.env[name];
    }
  });

  afterEach(async () => {
    for (const name of ENV_NAMES) {
      delete process.env[name];
    }
    if (broker !== null) {
      await broker.close();
      broker = null;
    }
  });

  async function startBroker(answers: BrokerFixture["answers"]): Promise<BrokerFixture> {
    broker = await startBrokerFixture(answers);
    process.env["MB_AUTH_BROKER"] = broker.url;
    process.env["MB_AUTH_BROKER_TOKEN"] = SESSION_TOKEN;
    return broker;
  }

  it("takes the broker's grant when the broker variables are set, with a refresher", async () => {
    await startBroker([
      {
        status: 200,
        body: {
          url: "https://mb.example.com",
          credential: { kind: "oauth", accessToken: "acc-1", expiresAt: EXPIRES_AT },
          worktreeId: null,
        },
      },
    ]);
    process.env["MB_URL"] = "https://mb.example.com/";

    const resolved = await resolveConfig({ signal: SIGNAL });

    expect({ url: resolved.url, credential: resolved.credential }).toEqual({
      url: "https://mb.example.com",
      credential: { kind: "bearer", accessToken: "acc-1", expiresAt: EXPIRES_AT },
    });
    expect(resolved.refreshCredential).not.toBeNull();
  });

  it("prefers the broker over MB_API_KEY when both are set", async () => {
    await startBroker([
      {
        status: 200,
        body: {
          url: "https://mb.example.com",
          credential: { kind: "apiKey", apiKey: "broker-key" },
          worktreeId: null,
        },
      },
    ]);
    process.env["MB_URL"] = "https://mb.example.com";
    process.env["MB_API_KEY"] = "env-key";

    const resolved = await resolveConfig({ signal: SIGNAL });

    expect(resolved.credential).toEqual({ kind: "apiKey", apiKey: "broker-key" });
  });

  it("refuses when MB_URL names a different server than the broker's grant", async () => {
    await startBroker([
      {
        status: 200,
        body: {
          url: "https://mb.example.com",
          credential: { kind: "apiKey", apiKey: "k" },
          worktreeId: null,
        },
      },
    ]);
    process.env["MB_URL"] = "https://other.example.com";

    await expect(resolveConfig({ signal: SIGNAL })).rejects.toThrow(
      new ConfigError(
        "MB_URL is https://other.example.com but the MB_AUTH_BROKER credential is for https://mb.example.com",
      ),
    );
  });

  it("takes the broker's url when MB_URL is unset", async () => {
    await startBroker([
      {
        status: 200,
        body: {
          url: "https://mb.example.com",
          credential: { kind: "apiKey", apiKey: "k" },
          worktreeId: null,
        },
      },
    ]);

    const resolved = await resolveConfig({ signal: SIGNAL });

    expect(resolved.url).toBe("https://mb.example.com");
  });

  it("refreshes through the broker once when Metabase answers 401", async () => {
    const fixture = await startBroker([
      {
        status: 200,
        body: {
          url: "https://mb.example.com",
          credential: { kind: "oauth", accessToken: "acc-1", expiresAt: EXPIRES_AT },
          worktreeId: null,
        },
      },
      {
        status: 200,
        body: {
          url: "https://mb.example.com",
          credential: { kind: "oauth", accessToken: "acc-2", expiresAt: EXPIRES_AT },
          worktreeId: null,
        },
      },
    ]);
    const resolved = await resolveConfig({ signal: SIGNAL });
    const metabase = captureFetch([unauthorizedResponse(), jsonResponse({ id: 1 })]);
    const client = createClient(
      { url: resolved.url, credential: resolved.credential },
      {
        userAgent: "test",
        fetchImpl: metabase.fetch,
        ...(resolved.refreshCredential !== null && {
          refreshCredential: resolved.refreshCredential,
        }),
      },
    );

    await client.requestRaw("/api/user/current", { retries: 0 });

    expect(metabase.calls.map((call) => call.headers["authorization"])).toEqual([
      "Bearer acc-1",
      "Bearer acc-2",
    ]);
    expect(fixture.requests.map((request) => `${request.method} ${request.path}`)).toEqual([
      "GET /v1/credential",
      "POST /v1/credential/refresh",
    ]);
  });

  it("resolves MB_URL and MB_API_KEY without a refresher when there is no broker", async () => {
    process.env["MB_URL"] = "https://mb.example.com/";
    process.env["MB_API_KEY"] = "mb_key";

    await expect(resolveConfig({ signal: SIGNAL })).resolves.toEqual({
      url: "https://mb.example.com",
      credential: { kind: "apiKey", apiKey: "mb_key" },
      refreshCredential: null,
      worktreeId: null,
    });
  });

  it("refuses with the credential message when nothing is set", async () => {
    await expect(resolveConfig({ signal: SIGNAL })).rejects.toThrow(
      new ConfigError(NO_CREDENTIAL_MESSAGE),
    );
    expect(NO_CREDENTIAL_MESSAGE).toBe(
      "no Metabase credential; run inside Metabase RDE, or set MB_URL and MB_API_KEY",
    );
  });

  it("refuses when only one of MB_URL and MB_API_KEY is set, or one is empty", async () => {
    process.env["MB_URL"] = "https://mb.example.com";
    await expect(resolveConfig({ signal: SIGNAL })).rejects.toThrow(NO_CREDENTIAL_MESSAGE);
    process.env["MB_API_KEY"] = "";
    await expect(resolveConfig({ signal: SIGNAL })).rejects.toThrow(NO_CREDENTIAL_MESSAGE);
    delete process.env["MB_URL"];
    process.env["MB_API_KEY"] = "mb_key";
    await expect(resolveConfig({ signal: SIGNAL })).rejects.toThrow(NO_CREDENTIAL_MESSAGE);
  });
});
