import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import type { ConnectionState } from "../../contracts/connection";

import { ConnectionRefresher } from "./refresh";

const DISCOVERY_PATH = "/.well-known/oauth-authorization-server";
const TOKEN_PATH = "/oauth/token";
const BAD_REQUEST = 400;
const UNAVAILABLE = 503;
const NOW = Date.parse("2026-09-22T12:00:00.000Z");

const USER = { id: 1, email: "ada@example.com", name: "Ada Lovelace", isSuperuser: true };
const SERVER = {
  version: "v1.60.0",
  edition: "ee",
  features: { remoteSync: true, transforms: true, transformTests: true },
} as const;

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => {
            resolve();
          });
        }),
    ),
  );
});

// A Metabase whose token endpoint answers every refresh with one status and body.
async function metabaseAnswering(status: number, body: string): Promise<string> {
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const base = `http://127.0.0.1:${String(portOf(server))}`;
    if (request.url === DISCOVERY_PATH) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          issuer: base,
          authorization_endpoint: `${base}/oauth/authorize`,
          token_endpoint: `${base}${TOKEN_PATH}`,
        }),
      );
      return;
    }
    response.writeHead(status, { "content-type": "application/json" });
    response.end(body);
  });
  servers.push(server);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  return `http://127.0.0.1:${String(portOf(server))}`;
}

function portOf(server: Server): number {
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("the fixture server has no port");
  }
  const info: AddressInfo = address;
  return info.port;
}

interface Watched {
  readonly refresher: ConnectionRefresher;
  readonly states: ConnectionState[];
  readonly logged: string[];
}

function connectedTo(url: string): Watched {
  const states: ConnectionState[] = [];
  const logged: string[] = [];
  const refresher = new ConnectionRefresher({
    persist: async () => undefined,
    now: () => NOW,
    onChange: (state) => {
      states.push(state);
    },
    log: (message) => {
      logged.push(message);
    },
  });
  refresher.adopt({
    url,
    user: USER,
    server: SERVER,
    connectedAt: "2026-09-22T10:00:00.000Z",
    credential: {
      kind: "oauth",
      accessToken: "access-old",
      refreshToken: "refresh-old",
      expiresAt: "2026-09-22T11:00:00.000Z",
      clientId: "client-1",
    },
  });
  return { refresher, states, logged };
}

describe("ConnectionRefresher when Metabase refuses the refresh", () => {
  it("signs out with a reason a person can act on and tells the window", async () => {
    const url = await metabaseAnswering(BAD_REQUEST, JSON.stringify({ error: "invalid_grant" }));
    const { refresher, states, logged } = connectedTo(url);
    const reason = `Metabase at ${url} signed this app out. Sign in again in Settings.`;

    expect(await refresher.getAccessToken()).toEqual({ kind: "unavailable", reason });
    expect(states.at(-1)).toEqual({ kind: "signed-out", url, user: USER, reason });
    expect(logged).toEqual([
      `connection: renewing the sign-in to ${url} was refused: OAuth token refresh failed (400): invalid_grant`,
    ]);
  });
});

describe("ConnectionRefresher when Metabase does not answer the refresh", () => {
  it("keeps the old token, marks the connection stale and tells the window", async () => {
    const url = await metabaseAnswering(UNAVAILABLE, "");
    const { refresher, states } = connectedTo(url);

    const grant = await refresher.getAccessToken();

    expect(grant).toEqual({
      kind: "granted",
      url,
      credential: {
        kind: "oauth",
        accessToken: "access-old",
        expiresAt: "2026-09-22T11:00:00.000Z",
      },
    });
    expect(states.at(-1)).toEqual({
      kind: "stale",
      url,
      user: USER,
      server: SERVER,
      lastProbeAt: "2026-09-22T10:00:00.000Z",
      reason: `Metabase at ${url} didn't answer. The app tries again when a session next needs it.`,
    });
  });
});
