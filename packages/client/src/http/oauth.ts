import { z } from "zod";

import { SessionProperties } from "../domain/session-properties";
import { JSON_CONTENT_TYPE, parseJsonResult } from "../json";
import { ConfigError, errorMessage, TimeoutError } from "../errors";
import { combineAborts, throwIfAborted } from "../signal";
import { assertEndpointOrigin } from "../url";
import { PROBE_PATH, serverInfoFromProperties } from "../version/probe";
import { createServerProfile } from "../version/profile";

import { HttpError, isRetryableStatus } from "./errors";
import { buildNetworkError } from "./network-error";

const DISCOVERY_PATH = "/.well-known/oauth-authorization-server";
const FORM_CONTENT_TYPE = "application/x-www-form-urlencoded";
const OAUTH_TIMEOUT_MS = 30_000;

type OAuthMethod = "GET" | "POST";

interface OAuthRequest {
  url: string;
  method: OAuthMethod;
  userAgent: string;
  headers: Record<string, string>;
  body?: string | URLSearchParams;
  signal?: AbortSignal | undefined;
}

// Single fetch path for every OAuth protocol call: stamps the caller's user-agent, enforces the
// timeout, and maps transport failures to the same NetworkError/TimeoutError taxonomy as the typed
// client — so a refresh that can't reach the server surfaces a diagnostic instead of a bare
// `TypeError: fetch failed` that masks the original error.
async function oauthFetch(request: OAuthRequest): Promise<Response> {
  const timeoutSignal = AbortSignal.timeout(OAUTH_TIMEOUT_MS);
  try {
    return await fetch(request.url, {
      method: request.method,
      headers: { ...request.headers, "user-agent": request.userAgent },
      ...(request.body !== undefined ? { body: request.body } : {}),
      signal: combineAborts(timeoutSignal, request.signal),
    });
  } catch (error) {
    throwIfAborted(request.signal);
    if (timeoutSignal.aborted) {
      throw new TimeoutError(`OAuth request timed out after ${OAUTH_TIMEOUT_MS}ms`, {
        kind: "http",
        method: request.method,
        url: request.url,
        timeoutMs: OAUTH_TIMEOUT_MS,
      });
    }
    throw buildNetworkError(error, request.method, request.url);
  }
}

// The CLI always authorizes with the single full-access scope; it never requests anything narrower,
// so scope is a fixed constant rather than a per-call parameter.
export const OAUTH_SCOPE = "mb:full";

export const OAuthServerMetadata = z
  .object({
    issuer: z.string(),
    authorization_endpoint: z.string(),
    token_endpoint: z.string(),
    registration_endpoint: z.string().optional(),
    revocation_endpoint: z.string().optional(),
    scopes_supported: z.array(z.string()).optional(),
  })
  .loose();
export type OAuthServerMetadata = z.infer<typeof OAuthServerMetadata>;

export const RegisteredClient = z.object({ client_id: z.string() }).loose();
export type RegisteredClient = z.infer<typeof RegisteredClient>;

export const OAuthTokens = z
  .object({
    access_token: z.string(),
    token_type: z.string(),
    expires_in: z.number().int().optional(),
    refresh_token: z.string().optional(),
  })
  .loose();
export type OAuthTokens = z.infer<typeof OAuthTokens>;

const OAuthErrorBody = z
  .object({ error: z.string(), error_description: z.string().optional() })
  .loose();

export interface ClientRegistration {
  registrationEndpoint: string;
  redirectUri: string;
  clientName: string;
  userAgent: string;
  signal?: AbortSignal | undefined;
}

export interface CodeExchange {
  tokenEndpoint: string;
  code: string;
  redirectUri: string;
  clientId: string;
  codeVerifier: string;
  userAgent: string;
  signal?: AbortSignal | undefined;
}

export interface TokenRefresh {
  tokenEndpoint: string;
  refreshToken: string;
  clientId: string;
  userAgent: string;
}

export interface TokenRevocation {
  revocationEndpoint: string;
  token: string;
  clientId: string;
  userAgent: string;
}

// The request's signal also cuts off its body, so a read failing after an abort is the abort.
async function readJson<T>(
  response: Response,
  schema: z.ZodType<T>,
  source: string,
  signal: AbortSignal | undefined,
): Promise<T> {
  let raw: unknown;
  try {
    raw = await response.json();
  } catch (error) {
    throwIfAborted(signal);
    throw new ConfigError(`${source}: invalid JSON response (${errorMessage(error)})`);
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ConfigError(`${source}: unexpected response shape`);
  }
  return parsed.data;
}

async function failure(
  response: Response,
  source: string,
  request: OAuthRequest,
): Promise<ConfigError | HttpError> {
  const rawBody = await response.text().catch(() => "");
  throwIfAborted(request.signal);
  // Transient/server statuses (5xx, 429, 408) go through the HTTP taxonomy — retryable, exit 1 —
  // not ConfigError. A ConfigError from a refresh is read as a dead grant ("log in again"); a
  // token-endpoint blip must not be mistaken for one.
  if (isRetryableStatus(response.status)) {
    return new HttpError({
      status: response.status,
      statusText: response.statusText,
      method: request.method,
      url: request.url,
      responseHeaders: response.headers,
      rawBody,
    });
  }
  const parsed = parseJsonResult(rawBody, OAuthErrorBody);
  if (parsed.ok) {
    const detail = parsed.value.error_description ?? parsed.value.error;
    return new ConfigError(`${source} failed (${response.status}): ${detail}`);
  }
  return new ConfigError(`${source} failed (${response.status})`);
}

async function postForm<T>(
  url: string,
  userAgent: string,
  params: Record<string, string>,
  schema: z.ZodType<T>,
  source: string,
  signal?: AbortSignal,
): Promise<T> {
  const request: OAuthRequest = {
    url,
    method: "POST",
    userAgent,
    headers: { "content-type": FORM_CONTENT_TYPE, accept: JSON_CONTENT_TYPE },
    body: new URLSearchParams(params),
    signal,
  };
  const response = await oauthFetch(request);
  if (!response.ok) {
    throw await failure(response, source, request);
  }
  return readJson(response, schema, source, signal);
}

// The release whose discovery first advertises the full-access scope; see `grantsFullAccessScope`.
export const OAUTH_MINIMUM_RELEASE = "v62.3.3";

export const OAUTH_UNSUPPORTED_MESSAGE = `this Metabase does not support OAuth login (requires Metabase ${OAUTH_MINIMUM_RELEASE} or newer)`;

// Pre-v60 Metabase answers the discovery path with the SPA shell (200 text/html) or a 404, so "no
// OAuth server" is any non-2xx or non-JSON response. Network-level failures still throw.
// The well-known path is appended after any subpath (base + /.well-known/...), not inserted
// between host and path as RFC 8414 prescribes — Metabase routes it like /api/*, so a
// subpath-hosted instance serves discovery under its prefix.
async function fetchMetadata(
  baseUrl: string,
  userAgent: string,
  signal?: AbortSignal,
): Promise<OAuthServerMetadata | null> {
  const url = `${baseUrl}${DISCOVERY_PATH}`;
  const response = await oauthFetch({
    url,
    method: "GET",
    userAgent,
    headers: { accept: JSON_CONTENT_TYPE },
    signal,
  });
  const contentType = response.headers.get("content-type") ?? "";
  if (!response.ok || !contentType.includes("json")) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  return readJson(response, OAuthServerMetadata, "OAuth discovery", signal);
}

// Pin every endpoint we will send secrets to back to the configured base URL's origin before any
// caller uses them, so a tampered discovery document can't redirect tokens to another host.
function pinEndpoints(metadata: OAuthServerMetadata, baseUrl: string): OAuthServerMetadata {
  assertEndpointOrigin(metadata.issuer, baseUrl, "issuer");
  assertEndpointOrigin(metadata.authorization_endpoint, baseUrl, "authorization endpoint");
  assertEndpointOrigin(metadata.token_endpoint, baseUrl, "token endpoint");
  if (metadata.registration_endpoint !== undefined) {
    assertEndpointOrigin(metadata.registration_endpoint, baseUrl, "registration endpoint");
  }
  if (metadata.revocation_endpoint !== undefined) {
    assertEndpointOrigin(metadata.revocation_endpoint, baseUrl, "revocation endpoint");
  }
  return metadata;
}

// Discovery advertises the full-access scope from the v62 patch that introduced it through v63;
// v60, v61 and the earlier v62 patches serve an OAuth server for the agent API only, and v64 keeps
// the scope out of `scopes_supported` on purpose while still granting it. A v62 major cannot say
// which side of that patch it is on, so a discovery document that names the scope settles it, and
// only one that does not falls back to the version, read from the properties endpoint, which
// answers without a credential.
async function grantsFullAccessScope(
  metadata: OAuthServerMetadata,
  baseUrl: string,
  userAgent: string,
  signal?: AbortSignal,
): Promise<boolean> {
  if (metadata.scopes_supported?.includes(OAUTH_SCOPE) === true) {
    return true;
  }
  const request: OAuthRequest = {
    url: `${baseUrl}${PROBE_PATH}`,
    method: "GET",
    userAgent,
    headers: { accept: JSON_CONTENT_TYPE },
    signal,
  };
  const response = await oauthFetch(request);
  if (!response.ok) {
    throw await failure(response, "Server properties", request);
  }
  const properties = await readJson(response, SessionProperties, "Server properties", signal);
  const profile = createServerProfile(serverInfoFromProperties(properties));
  return profile.features.oauthFullAccessScopeUnadvertised;
}

// The discovery document when the server can log a client in to the whole REST API, else null.
export async function tryDiscoverMetadata(
  baseUrl: string,
  userAgent: string,
  signal?: AbortSignal,
): Promise<OAuthServerMetadata | null> {
  const metadata = await fetchMetadata(baseUrl, userAgent, signal);
  if (metadata === null || !(await grantsFullAccessScope(metadata, baseUrl, userAgent, signal))) {
    return null;
  }
  return pinEndpoints(metadata, baseUrl);
}

export async function discoverLoginMetadata(
  baseUrl: string,
  userAgent: string,
  signal?: AbortSignal,
): Promise<OAuthServerMetadata> {
  const metadata = await tryDiscoverMetadata(baseUrl, userAgent, signal);
  if (metadata === null) {
    throw new ConfigError(OAUTH_UNSUPPORTED_MESSAGE);
  }
  return metadata;
}

// For a grant already held: the server that issued it needs no second look at what it supports.
export async function discoverMetadata(
  baseUrl: string,
  userAgent: string,
): Promise<OAuthServerMetadata> {
  const metadata = await fetchMetadata(baseUrl, userAgent);
  if (metadata === null) {
    throw new ConfigError(OAUTH_UNSUPPORTED_MESSAGE);
  }
  return pinEndpoints(metadata, baseUrl);
}

export async function registerClient(input: ClientRegistration): Promise<RegisteredClient> {
  const request: OAuthRequest = {
    url: input.registrationEndpoint,
    method: "POST",
    userAgent: input.userAgent,
    headers: { "content-type": JSON_CONTENT_TYPE, accept: JSON_CONTENT_TYPE },
    body: JSON.stringify({
      application_type: "native",
      client_name: input.clientName,
      redirect_uris: [input.redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: OAUTH_SCOPE,
    }),
    signal: input.signal,
  };
  const response = await oauthFetch(request);
  if (!response.ok) {
    throw await failure(response, "OAuth client registration", request);
  }
  return readJson(response, RegisteredClient, "OAuth client registration", input.signal);
}

export function exchangeCode(input: CodeExchange): Promise<OAuthTokens> {
  return postForm(
    input.tokenEndpoint,
    input.userAgent,
    {
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: input.redirectUri,
      client_id: input.clientId,
      code_verifier: input.codeVerifier,
    },
    OAuthTokens,
    "OAuth token exchange",
    input.signal,
  );
}

export function refreshTokens(input: TokenRefresh): Promise<OAuthTokens> {
  return postForm(
    input.tokenEndpoint,
    input.userAgent,
    {
      grant_type: "refresh_token",
      refresh_token: input.refreshToken,
      client_id: input.clientId,
    },
    OAuthTokens,
    "OAuth token refresh",
  );
}

export async function revokeToken(input: TokenRevocation): Promise<void> {
  const request: OAuthRequest = {
    url: input.revocationEndpoint,
    method: "POST",
    userAgent: input.userAgent,
    headers: { "content-type": FORM_CONTENT_TYPE },
    body: new URLSearchParams({ token: input.token, client_id: input.clientId }),
  };
  const response = await oauthFetch(request);
  if (!response.ok) {
    throw await failure(response, "OAuth token revocation", request);
  }
  // Drain the (ignored) success body so the socket is released and can't delay process exit.
  await response.body?.cancel().catch(() => undefined);
}
