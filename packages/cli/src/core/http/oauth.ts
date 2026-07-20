import { z } from "zod";

import { JSON_CONTENT_TYPE, parseJsonResult } from "../../runtime/json";
import { ConfigError, errorMessage, TimeoutError } from "../errors";
import { assertEndpointOrigin } from "../url";

import { USER_AGENT } from "./client";
import { HttpError, isRetryableStatus } from "./errors";
import { buildNetworkError } from "./network-error";

const DISCOVERY_PATH = "/.well-known/oauth-authorization-server";
const FORM_CONTENT_TYPE = "application/x-www-form-urlencoded";
const OAUTH_TIMEOUT_MS = 30_000;

type OAuthMethod = "GET" | "POST";

interface OAuthRequest {
  url: string;
  method: OAuthMethod;
  headers: Record<string, string>;
  body?: string | URLSearchParams;
}

// Single fetch path for every OAuth protocol call: stamps the shared user-agent, enforces the
// timeout, and maps transport failures to the same NetworkError/TimeoutError taxonomy as the typed
// client — so a refresh that can't reach the server surfaces a diagnostic instead of a bare
// `TypeError: fetch failed` that masks the original error.
async function oauthFetch(request: OAuthRequest): Promise<Response> {
  const timeoutSignal = AbortSignal.timeout(OAUTH_TIMEOUT_MS);
  try {
    return await fetch(request.url, {
      method: request.method,
      headers: { ...request.headers, "user-agent": USER_AGENT },
      ...(request.body !== undefined ? { body: request.body } : {}),
      signal: timeoutSignal,
    });
  } catch (error) {
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
}

export interface CodeExchange {
  tokenEndpoint: string;
  code: string;
  redirectUri: string;
  clientId: string;
  codeVerifier: string;
}

export interface TokenRefresh {
  tokenEndpoint: string;
  refreshToken: string;
  clientId: string;
}

export interface TokenRevocation {
  revocationEndpoint: string;
  token: string;
  clientId: string;
}

async function readJson<T>(response: Response, schema: z.ZodType<T>, source: string): Promise<T> {
  let raw: unknown;
  try {
    raw = await response.json();
  } catch (error) {
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
  method: OAuthMethod,
  url: string,
): Promise<ConfigError | HttpError> {
  const rawBody = await response.text().catch(() => "");
  // Transient/server statuses (5xx, 429, 408) go through the HTTP taxonomy — retryable, exit 1 —
  // not ConfigError. A ConfigError from a refresh is read as a dead grant ("log in again"); a
  // token-endpoint blip must not be mistaken for one.
  if (isRetryableStatus(response.status)) {
    return new HttpError({
      status: response.status,
      statusText: response.statusText,
      method,
      url,
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
  params: Record<string, string>,
  schema: z.ZodType<T>,
  source: string,
): Promise<T> {
  const response = await oauthFetch({
    url,
    method: "POST",
    headers: { "content-type": FORM_CONTENT_TYPE, accept: JSON_CONTENT_TYPE },
    body: new URLSearchParams(params),
  });
  if (!response.ok) {
    throw await failure(response, source, "POST", url);
  }
  return readJson(response, schema, source);
}

export const OAUTH_UNSUPPORTED_MESSAGE =
  "this Metabase does not support OAuth login (requires Metabase v63 or newer)";

// Probe whether the server supports OAuth login for the CLI. Returns null when it does not:
// pre-v60 Metabase answers the discovery path with the SPA shell (200 text/html) or a 404, so
// "unsupported" is any non-2xx or non-JSON response; v60–62 expose an OAuth authorization
// server scoped to the agent API/MCP only — see the scopes_supported check below. Network-level
// failures still throw.
// The well-known path is appended after any subpath (base + /.well-known/...), not inserted
// between host and path as RFC 8414 prescribes — Metabase routes it like /api/*, so a
// subpath-hosted instance serves discovery under its prefix.
export async function tryDiscoverMetadata(baseUrl: string): Promise<OAuthServerMetadata | null> {
  const url = `${baseUrl}${DISCOVERY_PATH}`;
  const response = await oauthFetch({
    url,
    method: "GET",
    headers: { accept: JSON_CONTENT_TYPE },
  });
  const contentType = response.headers.get("content-type") ?? "";
  if (!response.ok || !contentType.includes("json")) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  const metadata = await readJson(response, OAuthServerMetadata, "OAuth discovery");
  // A server that doesn't grant the full-access scope only issues agent-API/MCP-scoped tokens
  // (Metabase v60–62); the general REST API rejects them, so for the CLI it's "no OAuth support".
  const scopes = metadata.scopes_supported;
  if (scopes !== undefined && !scopes.includes(OAUTH_SCOPE)) {
    return null;
  }
  // Pin every endpoint we will send secrets to back to the configured base URL's origin before
  // any caller uses them, so a tampered discovery document can't redirect tokens to another host.
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

export async function discoverMetadata(baseUrl: string): Promise<OAuthServerMetadata> {
  const metadata = await tryDiscoverMetadata(baseUrl);
  if (metadata === null) {
    throw new ConfigError(OAUTH_UNSUPPORTED_MESSAGE);
  }
  return metadata;
}

export async function registerClient(input: ClientRegistration): Promise<RegisteredClient> {
  const response = await oauthFetch({
    url: input.registrationEndpoint,
    method: "POST",
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
  });
  if (!response.ok) {
    throw await failure(response, "OAuth client registration", "POST", input.registrationEndpoint);
  }
  return readJson(response, RegisteredClient, "OAuth client registration");
}

export function exchangeCode(input: CodeExchange): Promise<OAuthTokens> {
  return postForm(
    input.tokenEndpoint,
    {
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: input.redirectUri,
      client_id: input.clientId,
      code_verifier: input.codeVerifier,
    },
    OAuthTokens,
    "OAuth token exchange",
  );
}

export function refreshTokens(input: TokenRefresh): Promise<OAuthTokens> {
  return postForm(
    input.tokenEndpoint,
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
  const response = await oauthFetch({
    url: input.revocationEndpoint,
    method: "POST",
    headers: { "content-type": FORM_CONTENT_TYPE },
    body: new URLSearchParams({ token: input.token, client_id: input.clientId }),
  });
  if (!response.ok) {
    throw await failure(response, "OAuth token revocation", "POST", input.revocationEndpoint);
  }
  // Drain the (ignored) success body so the socket is released and can't delay process exit.
  await response.body?.cancel().catch(() => undefined);
}
