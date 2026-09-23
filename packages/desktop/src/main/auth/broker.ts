import { randomBytes, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { errorMessage } from "@metabase/client/errors";
import { JSON_CONTENT_TYPE } from "@metabase/client/json";

import { BrokerGrant, BrokerRefusal } from "../../contracts/broker";
import type { MetabaseWorktree } from "../../contracts/metabase";

import type { CredentialGrant } from "./refresh";

const LOOPBACK_HOST = "127.0.0.1";
const EPHEMERAL_PORT = 0;
const SESSION_TOKEN_BYTES = 32;
const TOKEN_ENCODING = "base64url";
const BEARER_PREFIX = "Bearer ";

const CREDENTIAL_PATH = "/v1/credential";
const REFRESH_PATH = "/v1/credential/refresh";

const OK_STATUS = 200;
const UNAUTHORIZED_STATUS = 401;
const NOT_FOUND_STATUS = 404;
const UNAVAILABLE_STATUS = 503;
const INTERNAL_STATUS = 500;

// A session looping on a Metabase 401 would otherwise hammer the token endpoint through us.
const MIN_REFRESH_SPACING_MS = 10_000;

const UNAUTHORIZED_REASON = "this session token is not one RDE issued";
const UNKNOWN_ROUTE_REASON = "no such broker route";
const NO_WORKTREE_REASON = "the session's Metabase worktree could not be made";

// Asked on every grant rather than once at minting, so a worktree ensured after the session
// started, or one for the branch it moved to, reaches its next command.
export type WorktreeLookup = () => Promise<MetabaseWorktree>;

export interface BrokerSession {
  readonly sessionId: string;
  readonly token: string;
}

interface BrokerDeps {
  readonly getAccessToken: () => Promise<CredentialGrant>;
  readonly forceRefresh: () => Promise<CredentialGrant>;
  readonly log: (message: string) => void;
  readonly now: () => number;
}

interface SessionRecord {
  readonly sessionId: string;
  readonly worktree: WorktreeLookup;
  lastRefreshAt: number | null;
}

function send(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": JSON_CONTENT_TYPE,
    "content-length": Buffer.byteLength(payload),
  });
  response.end(payload);
}

function refuse(response: ServerResponse, status: number, reason: string): void {
  send(response, status, BrokerRefusal.parse({ reason }));
}

function bearerToken(authorization: string | undefined): string | null {
  if (authorization === undefined || !authorization.startsWith(BEARER_PREFIX)) {
    return null;
  }
  const token = authorization.slice(BEARER_PREFIX.length);
  return token.length === 0 ? null : token;
}

export class CredentialBroker {
  private readonly server: Server;
  private readonly byToken = new Map<string, SessionRecord>();
  private readonly tokenBySession = new Map<string, string>();
  private origin: string | null = null;

  private constructor(private readonly deps: BrokerDeps) {
    this.server = createServer((request, response) => {
      void this.serve(request, response);
    });
  }

  static async start(deps: BrokerDeps): Promise<CredentialBroker> {
    const broker = new CredentialBroker(deps);
    await broker.listen();
    return broker;
  }

  get url(): string {
    if (this.origin === null) {
      throw new Error("the credential broker is not listening");
    }
    return this.origin;
  }

  mintSession(worktree: WorktreeLookup): BrokerSession {
    const sessionId = randomUUID();
    const token = randomBytes(SESSION_TOKEN_BYTES).toString(TOKEN_ENCODING);
    this.byToken.set(token, { sessionId, worktree, lastRefreshAt: null });
    this.tokenBySession.set(sessionId, token);
    this.deps.log(`broker: minted session ${sessionId}`);
    return { sessionId, token };
  }

  revokeSession(sessionId: string): void {
    const token = this.tokenBySession.get(sessionId);
    if (token === undefined) {
      return;
    }
    this.tokenBySession.delete(sessionId);
    this.byToken.delete(token);
    this.deps.log(`broker: revoked session ${sessionId}`);
  }

  close(): Promise<void> {
    this.byToken.clear();
    this.tokenBySession.clear();
    this.server.closeAllConnections();
    return new Promise<void>((resolve, reject) => {
      this.server.close((error) => {
        if (error === undefined) {
          resolve();
          return;
        }
        reject(error);
      });
    });
  }

  private listen(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(EPHEMERAL_PORT, LOOPBACK_HOST, () => {
        const address = this.server.address();
        if (address === null || typeof address === "string") {
          reject(new Error("the credential broker bound no TCP port"));
          return;
        }
        const { port }: AddressInfo = address;
        this.origin = `http://${LOOPBACK_HOST}:${port}`;
        resolve();
      });
    });
  }

  private async serve(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      await this.route(request, response);
    } catch (error) {
      refuse(response, INTERNAL_STATUS, errorMessage(error));
    }
  }

  private async route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const token = bearerToken(request.headers.authorization);
    const session = token === null ? undefined : this.byToken.get(token);
    if (session === undefined) {
      refuse(response, UNAUTHORIZED_STATUS, UNAUTHORIZED_REASON);
      return;
    }
    if (request.method === "GET" && request.url === CREDENTIAL_PATH) {
      await this.answer(response, session, await this.deps.getAccessToken());
      return;
    }
    if (request.method === "POST" && request.url === REFRESH_PATH) {
      await this.answer(response, session, await this.renew(session));
      return;
    }
    refuse(response, NOT_FOUND_STATUS, UNKNOWN_ROUTE_REASON);
  }

  private renew(session: SessionRecord): Promise<CredentialGrant> {
    const last = session.lastRefreshAt;
    const now = this.deps.now();
    if (last !== null && now - last < MIN_REFRESH_SPACING_MS) {
      this.deps.log(
        `broker: session ${session.sessionId} asked to refresh inside the minimum spacing`,
      );
      return this.deps.getAccessToken();
    }
    session.lastRefreshAt = now;
    return this.deps.forceRefresh();
  }

  // A session whose worktree could not be made gets no credential at all: the main app is never
  // where its work lands in the worktree's place.
  private async answer(
    response: ServerResponse,
    session: SessionRecord,
    grant: CredentialGrant,
  ): Promise<void> {
    if (grant.kind === "unavailable") {
      this.deps.log(`broker: refused session ${session.sessionId}: ${grant.reason}`);
      refuse(response, UNAVAILABLE_STATUS, grant.reason);
      return;
    }
    const worktree = await session.worktree();
    if (worktree.kind === "failed") {
      const reason = `${NO_WORKTREE_REASON}: ${worktree.message}`;
      this.deps.log(`broker: refused session ${session.sessionId}: ${reason}`);
      refuse(response, UNAVAILABLE_STATUS, reason);
      return;
    }
    const worktreeId = worktree.kind === "ready" ? worktree.id : null;
    this.deps.log(
      `broker: granted a ${grant.credential.kind} credential to session ${session.sessionId}`,
    );
    send(
      response,
      OK_STATUS,
      BrokerGrant.parse({ url: grant.url, credential: grant.credential, worktreeId }),
    );
  }
}
