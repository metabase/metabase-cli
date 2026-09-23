// Constructed, not recorded: a real Metabase decides how long its tokens live and whether a refresh
// is granted, so this front plays the authorization server, with a short token lifetime and
// refreshes it grants or refuses on cue, and forwards every other request to the slot's Metabase
// under the bootstrap API key. Its discovery advertises the full-access scope, so the probe finds it
// without asking for the server's version.
import { randomUUID } from "node:crypto";
import {
  createServer,
  request,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type OutgoingHttpHeaders,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";

import { JSON_CONTENT_TYPE } from "@metabase/client/json";
import { OAUTH_SCOPE } from "@metabase/client/http/oauth";

import type { E2EBootstrap } from "../../../../tests/e2e/bootstrap-data";
import { DriverFailure } from "../app";

const LOOPBACK_HOST = "127.0.0.1";
const DISCOVERY_PATH = "/.well-known/oauth-authorization-server";
const AUTHORIZE_PATH = "/oauth/authorize";
const TOKEN_PATH = "/oauth/token";
const REGISTER_PATH = "/oauth/register";
const BEARER_PREFIX = "Bearer ";
const API_KEY_HEADER = "x-api-key";
const DROPPED_HEADERS: ReadonlySet<string> = new Set(["authorization", "host"]);

// The client renews a minute ahead of expiry, so a token this short is due the moment it is issued
// and has expired outright a few seconds later.
const ACCESS_TOKEN_LIFETIME_S = 5;
const MS_PER_SECOND = 1000;

const HTTP_OK = 200;
const HTTP_CREATED = 201;
const HTTP_FOUND = 302;
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_BAD_GATEWAY = 502;

export type RefreshAnswer = "grant" | "refuse";

interface IssuedTokens {
  readonly access_token: string;
  readonly token_type: string;
  readonly expires_in: number;
  readonly refresh_token: string;
  readonly scope: string;
}

interface OAuthError {
  readonly error: string;
}

interface FrontState {
  refreshes: RefreshAnswer;
  expiresAt: number | null;
  readonly codes: Set<string>;
  readonly refreshTokens: Set<string>;
  readonly accessTokens: Set<string>;
}

export interface OAuthFront {
  readonly url: string;
  readonly answerRefreshes: (answer: RefreshAnswer) => void;
  // When the newest access token stops being valid, or null before the first one is issued.
  readonly expiresAt: () => number | null;
  // Closes the listener, so the address reads as unreachable; a second call does nothing.
  readonly stopAnswering: () => Promise<void>;
}

function sendJson(response: ServerResponse, status: number, body: object): void {
  response.writeHead(status, { "content-type": JSON_CONTENT_TYPE });
  response.end(JSON.stringify(body));
}

function splitTarget(target: string): [string, URLSearchParams] {
  const at = target.indexOf("?");
  if (at === -1) {
    return [target, new URLSearchParams()];
  }
  return [target.slice(0, at), new URLSearchParams(target.slice(at + 1))];
}

async function readBody(message: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of message) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function issue(state: FrontState): IssuedTokens {
  const tokens: IssuedTokens = {
    access_token: `access-${randomUUID()}`,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_LIFETIME_S,
    refresh_token: `refresh-${randomUUID()}`,
    scope: OAUTH_SCOPE,
  };
  state.accessTokens.add(tokens.access_token);
  state.refreshTokens.add(tokens.refresh_token);
  state.expiresAt = Date.now() + ACCESS_TOKEN_LIFETIME_S * MS_PER_SECOND;
  return tokens;
}

const INVALID_GRANT: OAuthError = { error: "invalid_grant" };

function exchange(state: FrontState, form: URLSearchParams): IssuedTokens | OAuthError {
  const grantType = form.get("grant_type");
  if (grantType === "authorization_code") {
    const code = form.get("code");
    if (code === null || !state.codes.delete(code)) {
      return INVALID_GRANT;
    }
    return issue(state);
  }
  if (grantType === "refresh_token") {
    const refreshToken = form.get("refresh_token");
    if (state.refreshes === "refuse" || refreshToken === null) {
      return INVALID_GRANT;
    }
    if (!state.refreshTokens.delete(refreshToken)) {
      return INVALID_GRANT;
    }
    return issue(state);
  }
  return { error: "unsupported_grant_type" };
}

function isOAuthError(answer: IssuedTokens | OAuthError): answer is OAuthError {
  return "error" in answer;
}

function authorize(state: FrontState, query: URLSearchParams, response: ServerResponse): void {
  const redirectUri = query.get("redirect_uri");
  const clientState = query.get("state");
  if (redirectUri === null || clientState === null) {
    sendJson(response, HTTP_BAD_REQUEST, { error: "invalid_request" });
    return;
  }
  const code = `code-${randomUUID()}`;
  state.codes.add(code);
  const callback = new URLSearchParams({ code, state: clientState });
  response.writeHead(HTTP_FOUND, { location: `${redirectUri}?${callback.toString()}` });
  response.end();
}

function forwardedHeaders(headers: IncomingHttpHeaders, apiKey: string): OutgoingHttpHeaders {
  const kept = Object.entries(headers).filter(([name]) => !DROPPED_HEADERS.has(name));
  return { ...Object.fromEntries(kept), [API_KEY_HEADER]: apiKey };
}

function bearerOf(headers: IncomingHttpHeaders): string | null {
  const header = headers.authorization;
  if (header === undefined || !header.startsWith(BEARER_PREFIX)) {
    return null;
  }
  return header.slice(BEARER_PREFIX.length);
}

function forward(
  bootstrap: E2EBootstrap,
  target: string,
  incoming: IncomingMessage,
  response: ServerResponse,
): void {
  const outgoing = request(`${bootstrap.baseUrl}${target}`, {
    method: incoming.method,
    headers: forwardedHeaders(incoming.headers, bootstrap.adminApiKey),
  });
  outgoing.on("response", (answer) => {
    if (answer.statusCode === undefined) {
      sendJson(response, HTTP_BAD_GATEWAY, { error: "Metabase answered without a status" });
      return;
    }
    response.writeHead(answer.statusCode, answer.headers);
    answer.pipe(response);
  });
  outgoing.on("error", (error) => {
    sendJson(response, HTTP_BAD_GATEWAY, { error: error.message });
  });
  incoming.pipe(outgoing);
}

type Handler = (incoming: IncomingMessage, response: ServerResponse) => void;

function frontHandler(bootstrap: E2EBootstrap, base: string, state: FrontState): Handler {
  return (incoming, response) => {
    const target = incoming.url;
    if (target === undefined) {
      sendJson(response, HTTP_BAD_REQUEST, { error: "invalid_request" });
      return;
    }
    const [path, query] = splitTarget(target);
    if (path === DISCOVERY_PATH) {
      sendJson(response, HTTP_OK, {
        issuer: base,
        authorization_endpoint: `${base}${AUTHORIZE_PATH}`,
        token_endpoint: `${base}${TOKEN_PATH}`,
        registration_endpoint: `${base}${REGISTER_PATH}`,
        scopes_supported: [OAUTH_SCOPE],
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
      });
      return;
    }
    if (path === REGISTER_PATH) {
      void readBody(incoming).then(() => {
        sendJson(response, HTTP_CREATED, { client_id: `client-${randomUUID()}` });
      });
      return;
    }
    if (path === AUTHORIZE_PATH) {
      authorize(state, query, response);
      return;
    }
    if (path === TOKEN_PATH) {
      void readBody(incoming).then((body) => {
        const answer = exchange(state, new URLSearchParams(body));
        sendJson(response, isOAuthError(answer) ? HTTP_BAD_REQUEST : HTTP_OK, answer);
      });
      return;
    }
    const bearer = bearerOf(incoming.headers);
    if (bearer === null || !state.accessTokens.has(bearer)) {
      sendJson(response, HTTP_UNAUTHORIZED, { error: "invalid_token" });
      return;
    }
    forward(bootstrap, target, incoming, response);
  };
}

export async function startOAuthFront(bootstrap: E2EBootstrap): Promise<OAuthFront> {
  const state: FrontState = {
    refreshes: "grant",
    expiresAt: null,
    codes: new Set(),
    refreshTokens: new Set(),
    accessTokens: new Set(),
  };
  const server = createServer();
  const address = await new Promise<AddressInfo>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, LOOPBACK_HOST, () => {
      const bound = server.address();
      if (bound === null || typeof bound === "string") {
        reject(new DriverFailure("the OAuth front bound no TCP port"));
        return;
      }
      resolve(bound);
    });
  });
  const base = `http://${LOOPBACK_HOST}:${String(address.port)}`;
  server.on("request", frontHandler(bootstrap, base, state));

  return {
    url: base,
    answerRefreshes: (answer) => {
      state.refreshes = answer;
    },
    expiresAt: () => state.expiresAt,
    stopAnswering: () =>
      new Promise<void>((resolve, reject) => {
        if (!server.listening) {
          resolve();
          return;
        }
        server.close((error) => {
          if (error === undefined) {
            resolve();
            return;
          }
          reject(error);
        });
        server.closeAllConnections();
      }),
  };
}
