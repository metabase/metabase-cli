import type { OAuthTokens } from "../http/oauth";

export interface ApiKeyCredential {
  kind: "apiKey";
  apiKey: string;
}

export interface OAuthCredential {
  kind: "oauth";
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  clientId: string;
  scope: string;
}

export type Credential = ApiKeyCredential | OAuthCredential;

// Returns a refreshed credential to retry with, or null when refresh is impossible/declined.
export type CredentialRefresher = () => Promise<Credential | null>;

export const API_KEY_HEADER = "x-api-key";
export const AUTHORIZATION_HEADER = "authorization";
const BEARER_PREFIX = "Bearer ";

// Refresh slightly before the server-side expiry so a request never races the boundary.
const EXPIRY_SKEW_MS = 60_000;

// Fallback access-token lifetime when the token endpoint omits `expires_in`.
export const DEFAULT_EXPIRES_IN_SECONDS = 3600;

export interface AuthHeader {
  name: string;
  value: string;
}

export function credentialAuthHeader(credential: Credential): AuthHeader {
  if (credential.kind === "apiKey") {
    return { name: API_KEY_HEADER, value: credential.apiKey };
  }
  return { name: AUTHORIZATION_HEADER, value: BEARER_PREFIX + credential.accessToken };
}

export function credentialSecrets(credential: Credential): string[] {
  if (credential.kind === "apiKey") {
    return [credential.apiKey];
  }
  return [credential.accessToken, credential.refreshToken];
}

export function isOAuthExpired(credential: OAuthCredential, nowMs: number): boolean {
  const expiryMs = Date.parse(credential.expiresAt);
  // An unparseable expiry can't be trusted — fail safe by treating it as expired so the
  // credential is refreshed rather than used past an unknown lifetime.
  if (Number.isNaN(expiryMs)) {
    return true;
  }
  return expiryMs - EXPIRY_SKEW_MS <= nowMs;
}

export function expiresAtFromNow(expiresInSeconds: number, nowMs: number): string {
  return new Date(nowMs + expiresInSeconds * 1000).toISOString();
}

// Project a token-endpoint response onto an OAuthCredential. Shared by initial login and refresh so
// the access-token lifetime fallback lives in one place; the caller resolves the refresh token
// (required on login, retained-on-omission for refresh) and the client id.
export function oauthCredentialFromTokens(
  tokens: Pick<OAuthTokens, "access_token" | "expires_in">,
  refreshToken: string,
  clientId: string,
  scope: string,
  nowMs: number,
): OAuthCredential {
  return {
    kind: "oauth",
    accessToken: tokens.access_token,
    refreshToken,
    expiresAt: expiresAtFromNow(tokens.expires_in ?? DEFAULT_EXPIRES_IN_SECONDS, nowMs),
    clientId,
    scope,
  };
}
