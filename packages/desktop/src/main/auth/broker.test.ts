import { afterEach, describe, expect, it } from "vitest";

import { CredentialBroker, type BrokerSession } from "./broker";
import type { CredentialGrant } from "./refresh";

const METABASE_URL = "https://mb.example.com";

const OAUTH_GRANT: CredentialGrant = {
  kind: "granted",
  url: METABASE_URL,
  credential: {
    kind: "oauth",
    accessToken: "access-token",
    expiresAt: "2026-09-22T13:00:00.000Z",
  },
};

const REFRESHED_GRANT: CredentialGrant = {
  kind: "granted",
  url: METABASE_URL,
  credential: {
    kind: "oauth",
    accessToken: "refreshed-token",
    expiresAt: "2026-09-22T14:00:00.000Z",
  },
};

const SIGNED_OUT_REASON = "the refresh token was refused; sign in again";

interface BrokerHarness {
  readonly broker: CredentialBroker;
  readonly session: BrokerSession;
  readonly log: string[];
  readonly refreshCalls: () => number;
  setGrant(grant: CredentialGrant): void;
  advance(milliseconds: number): void;
  get(path: string, token: string): Promise<Response>;
  post(path: string, token: string): Promise<Response>;
}

const harnesses: BrokerHarness[] = [];

async function startBroker(): Promise<BrokerHarness> {
  let grant: CredentialGrant = OAUTH_GRANT;
  let refreshCalls = 0;
  let clock = Date.parse("2026-09-22T12:00:00.000Z");
  const log: string[] = [];
  const broker = await CredentialBroker.start({
    getAccessToken: async () => grant,
    forceRefresh: async () => {
      refreshCalls += 1;
      return grant.kind === "granted" ? REFRESHED_GRANT : grant;
    },
    log: (message) => log.push(message),
    now: () => clock,
  });
  const request = (path: string, method: string, token: string): Promise<Response> =>
    fetch(`${broker.url}${path}`, { method, headers: { authorization: `Bearer ${token}` } });
  const harness: BrokerHarness = {
    broker,
    session: broker.mintSession(),
    log,
    refreshCalls: () => refreshCalls,
    setGrant: (next) => {
      grant = next;
    },
    advance: (milliseconds) => {
      clock += milliseconds;
    },
    get: (path, token) => request(path, "GET", token),
    post: (path, token) => request(path, "POST", token),
  };
  harnesses.push(harness);
  return harness;
}

afterEach(async () => {
  await Promise.all(harnesses.map((harness) => harness.broker.close()));
  harnesses.length = 0;
});

describe("CredentialBroker", () => {
  it("grants the connected credential to a minted session", async () => {
    const harness = await startBroker();

    const response = await harness.get("/v1/credential", harness.session.token);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      url: METABASE_URL,
      credential: {
        kind: "oauth",
        accessToken: "access-token",
        expiresAt: "2026-09-22T13:00:00.000Z",
      },
    });
  });

  it("logs the grant by session id and never the token", async () => {
    const harness = await startBroker();

    await harness.get("/v1/credential", harness.session.token);

    expect(harness.log).toEqual([
      `broker: minted session ${harness.session.sessionId}`,
      `broker: granted a oauth credential to session ${harness.session.sessionId}`,
    ]);
  });

  it("answers 401 once the session is revoked", async () => {
    const harness = await startBroker();
    harness.broker.revokeSession(harness.session.sessionId);

    const response = await harness.get("/v1/credential", harness.session.token);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      reason: "this session token is not one RDE issued",
    });
  });

  it("answers 401 for a token it never issued", async () => {
    const harness = await startBroker();

    const response = await harness.get("/v1/credential", "not-a-session-token");

    expect(response.status).toBe(401);
  });

  it("answers 503 with the reason while the app is signed out", async () => {
    const harness = await startBroker();
    harness.setGrant({ kind: "unavailable", reason: SIGNED_OUT_REASON });

    const response = await harness.get("/v1/credential", harness.session.token);

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ reason: SIGNED_OUT_REASON });
  });

  it("refreshes once for a session inside the refresh interval", async () => {
    const harness = await startBroker();

    const first = await harness.post("/v1/credential/refresh", harness.session.token);
    harness.advance(9_999);
    const second = await harness.post("/v1/credential/refresh", harness.session.token);

    expect(harness.refreshCalls()).toBe(1);
    expect(await first.json()).toEqual({
      url: METABASE_URL,
      credential: {
        kind: "oauth",
        accessToken: "refreshed-token",
        expiresAt: "2026-09-22T14:00:00.000Z",
      },
    });
    expect(await second.json()).toEqual({
      url: METABASE_URL,
      credential: {
        kind: "oauth",
        accessToken: "access-token",
        expiresAt: "2026-09-22T13:00:00.000Z",
      },
    });
  });

  it("refreshes again once the interval has passed", async () => {
    const harness = await startBroker();

    await harness.post("/v1/credential/refresh", harness.session.token);
    harness.advance(10_000);
    await harness.post("/v1/credential/refresh", harness.session.token);

    expect(harness.refreshCalls()).toBe(2);
  });

  it("answers 404 for a route outside the contract", async () => {
    const harness = await startBroker();

    const response = await harness.get("/v1/credential/peek", harness.session.token);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ reason: "no such broker route" });
  });
});
