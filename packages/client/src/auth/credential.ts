import { ConfigError } from "../errors";
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

// Header field values are Latin-1 octets, so a credential carrying anything above U+00FF cannot be
// sent at all. Without this check the first request dies inside `Headers.set` with a bare TypeError
// that names an index into a value it does not name, outside the taxonomy a caller catches.
const MAX_HEADER_CODE_UNIT = 0xff;

interface CredentialSecret {
  field: string;
  value: string;
}

function headerBearingSecret(credential: Credential): CredentialSecret {
  if (credential.kind === "apiKey") {
    return { field: "apiKey", value: credential.apiKey };
  }
  return { field: "accessToken", value: credential.accessToken };
}

export function assertCredentialHeaderSafe(credential: Credential): void {
  const { field, value } = headerBearingSecret(credential);
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit > MAX_HEADER_CODE_UNIT) {
      const codePoint = codeUnit.toString(16).toUpperCase().padStart(4, "0");
      throw new ConfigError(
        `Credential field "${field}" has a character at index ${index} (U+${codePoint}) that cannot be sent in an HTTP header. ` +
          "Header values are limited to Latin-1; a smart quote, ellipsis, or dash substituted during copy-paste is the usual cause.",
      );
    }
  }
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
  nowMs: number,
): OAuthCredential {
  return {
    kind: "oauth",
    accessToken: tokens.access_token,
    refreshToken,
    expiresAt: expiresAtFromNow(tokens.expires_in ?? DEFAULT_EXPIRES_IN_SECONDS, nowMs),
    clientId,
  };
}
