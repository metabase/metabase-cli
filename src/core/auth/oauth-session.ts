import { discoverMetadata, refreshTokens, revokeToken } from "../http/oauth";

import { oauthCredentialFromTokens, type OAuthCredential } from "./credential";

// Exchange the rotating refresh token for a fresh access token. The server rotates refresh tokens,
// so a new one is expected back; if the endpoint omits it we keep the current refresh token.
export async function refreshOAuthCredential(
  baseUrl: string,
  credential: OAuthCredential,
  nowMs: number,
): Promise<OAuthCredential> {
  const metadata = await discoverMetadata(baseUrl, credential.scope);
  const tokens = await refreshTokens({
    tokenEndpoint: metadata.token_endpoint,
    refreshToken: credential.refreshToken,
    clientId: credential.clientId,
  });
  // The refresh request carries no scope parameter, so the new grant inherits the original
  // scope — a refresh can never widen it.
  return oauthCredentialFromTokens(
    tokens,
    tokens.refresh_token ?? credential.refreshToken,
    credential.clientId,
    credential.scope,
    nowMs,
  );
}

// Revoke both tokens server-side on logout. Metabase revokes exactly the token it is handed (no
// refresh-to-access cascade), so each must be revoked explicitly or the access token stays live
// until expiry. Refresh token goes first: if the second call fails, the long-lived grant is
// already dead. Returns false when the server advertises no revocation endpoint (nothing was
// revoked); network/protocol failures propagate to the caller.
export async function revokeOAuthCredential(
  baseUrl: string,
  credential: OAuthCredential,
): Promise<boolean> {
  const metadata = await discoverMetadata(baseUrl, credential.scope);
  const revocationEndpoint = metadata.revocation_endpoint;
  if (revocationEndpoint === undefined) {
    return false;
  }
  await revokeToken({
    revocationEndpoint,
    token: credential.refreshToken,
    clientId: credential.clientId,
  });
  await revokeToken({
    revocationEndpoint,
    token: credential.accessToken,
    clientId: credential.clientId,
  });
  return true;
}
