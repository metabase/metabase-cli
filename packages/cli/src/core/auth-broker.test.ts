import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ConfigError, ValidationError } from "@metabase/client/errors";

import {
  createBrokerRefresher,
  fetchBrokerCredential,
  readBrokerTarget,
  type BrokerTarget,
} from "./auth-broker";
import { startBrokerFixture, type BrokerFixture } from "./broker-fixture";

const SESSION_TOKEN = "session-token-1";
const EXPIRES_AT = "2026-09-22T12:00:00.000Z";
const OAUTH_GRANT = {
  url: "https://mb.example.com/",
  credential: { kind: "oauth", accessToken: "acc-1", expiresAt: EXPIRES_AT },
};
const API_KEY_GRANT = {
  url: "https://mb.example.com",
  credential: { kind: "apiKey", apiKey: "k1" },
};

describe("readBrokerTarget", () => {
  beforeEach(() => {
    delete process.env["MB_AUTH_BROKER"];
    delete process.env["MB_AUTH_BROKER_TOKEN"];
  });

  afterEach(() => {
    delete process.env["MB_AUTH_BROKER"];
    delete process.env["MB_AUTH_BROKER_TOKEN"];
  });

  it("is null when neither variable is set", () => {
    expect(readBrokerTarget()).toBeNull();
  });

  it("normalizes the broker url and keeps the token", () => {
    process.env["MB_AUTH_BROKER"] = "http://127.0.0.1:4242/";
    process.env["MB_AUTH_BROKER_TOKEN"] = SESSION_TOKEN;
    expect(readBrokerTarget()).toEqual({ url: "http://127.0.0.1:4242", token: SESSION_TOKEN });
  });

  it("refuses one variable without the other", () => {
    process.env["MB_AUTH_BROKER"] = "http://127.0.0.1:4242";
    expect(() => readBrokerTarget()).toThrow(
      new ConfigError(
        "MB_AUTH_BROKER and MB_AUTH_BROKER_TOKEN must be set together (one of them is missing)",
      ),
    );
  });
});

describe("fetchBrokerCredential", () => {
  let broker: BrokerFixture | null = null;

  afterEach(async () => {
    if (broker !== null) {
      await broker.close();
      broker = null;
    }
  });

  async function targetFor(answers: BrokerFixture["answers"]): Promise<BrokerTarget> {
    broker = await startBrokerFixture(answers);
    return { url: broker.url, token: SESSION_TOKEN };
  }

  it("hands back an oauth grant as a bearer credential for the normalized url", async () => {
    const target = await targetFor([{ status: 200, body: OAUTH_GRANT }]);

    const granted = await fetchBrokerCredential(target, { signal: new AbortController().signal });

    expect(granted).toEqual({
      url: "https://mb.example.com",
      credential: { kind: "bearer", accessToken: "acc-1", expiresAt: EXPIRES_AT },
    });
    expect(broker?.requests).toEqual([
      { method: "GET", path: "/v1/credential", authorization: `Bearer ${SESSION_TOKEN}` },
    ]);
  });

  it("hands back an api-key grant as an api-key credential", async () => {
    const target = await targetFor([{ status: 200, body: API_KEY_GRANT }]);

    const granted = await fetchBrokerCredential(target, { signal: new AbortController().signal });

    expect(granted).toEqual({
      url: "https://mb.example.com",
      credential: { kind: "apiKey", apiKey: "k1" },
    });
  });

  it("refuses when the broker rejects the session token", async () => {
    const target = await targetFor([{ status: 401, body: {} }]);

    await expect(
      fetchBrokerCredential(target, { signal: new AbortController().signal }),
    ).rejects.toThrow(
      new ConfigError("the Metabase RDE broker rejected this session's token (401)"),
    );
  });

  it("refuses with the broker's reason when the app has no credential", async () => {
    const target = await targetFor([{ status: 503, body: { reason: "signed out" } }]);

    await expect(
      fetchBrokerCredential(target, { signal: new AbortController().signal }),
    ).rejects.toThrow(
      new ConfigError("Metabase RDE has no credential for this session: signed out"),
    );
  });

  it("refuses on any other status", async () => {
    const target = await targetFor([{ status: 500, body: {} }]);

    await expect(
      fetchBrokerCredential(target, { signal: new AbortController().signal }),
    ).rejects.toThrow(
      new ConfigError("the Metabase RDE broker answered 500 for GET /v1/credential"),
    );
  });

  it("refuses a grant whose shape is not the contract", async () => {
    const target = await targetFor([{ status: 200, body: { url: "https://mb.example.com" } }]);

    const failure = await fetchBrokerCredential(target, {
      signal: new AbortController().signal,
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ValidationError);
    expect(failure).toMatchObject({
      message: `${target.url}/v1/credential: value did not match expected schema`,
    });
  });

  it("names the broker url when it cannot be reached", async () => {
    const target: BrokerTarget = { url: "http://127.0.0.1:1", token: SESSION_TOKEN };

    await expect(
      fetchBrokerCredential(target, { signal: new AbortController().signal }),
    ).rejects.toThrow("could not reach the Metabase RDE broker at http://127.0.0.1:1: ");
  });

  it("refreshes through POST /v1/credential/refresh and hands back the next credential", async () => {
    const target = await targetFor([
      {
        status: 200,
        body: { ...OAUTH_GRANT, credential: { ...OAUTH_GRANT.credential, accessToken: "acc-2" } },
      },
    ]);
    const refresh = createBrokerRefresher(target, { signal: new AbortController().signal });

    await expect(refresh()).resolves.toEqual({
      kind: "bearer",
      accessToken: "acc-2",
      expiresAt: EXPIRES_AT,
    });
    expect(broker?.requests).toEqual([
      { method: "POST", path: "/v1/credential/refresh", authorization: `Bearer ${SESSION_TOKEN}` },
    ]);
  });
});
