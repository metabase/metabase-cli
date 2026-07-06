import { ConfigError } from "../errors";
import {
  discoverMetadata,
  exchangeCode,
  OAUTH_SCOPE,
  registerClient,
  type OAuthServerMetadata,
} from "../http/oauth";

import { startCallbackServer } from "./callback-server";
import { oauthCredentialFromTokens, type OAuthCredential } from "./credential";
import { generatePkce, randomState } from "./pkce";

const CLIENT_NAME = "Metabase CLI";

export interface OAuthLoginInput {
  baseUrl: string;
  // Discovery document already fetched by the caller (login probes it to pick the auth method);
  // when omitted it is discovered here.
  metadata?: OAuthServerMetadata;
  clientId?: string;
  scope?: string;
  timeoutMs?: number;
}

export interface OAuthLoginDeps {
  openBrowser: (url: string) => Promise<boolean>;
  onAuthorizeUrl: (url: string, opened: boolean) => void;
  now: () => number;
}

function buildAuthorizeUrl(authorizationEndpoint: string, params: Record<string, string>): string {
  // RFC 6749 §3.1 allows the authorization endpoint to carry its own query component.
  const separator = authorizationEndpoint.includes("?") ? "&" : "?";
  return `${authorizationEndpoint}${separator}${new URLSearchParams(params).toString()}`;
}

async function resolveClientId(
  registrationEndpoint: string | undefined,
  redirectUri: string,
  provided: string | undefined,
  scope: string,
): Promise<string> {
  if (provided !== undefined) {
    return provided;
  }
  if (registrationEndpoint === undefined) {
    throw new ConfigError(
      "this Metabase has dynamic client registration disabled; pass --client-id with a pre-registered native client",
    );
  }
  const registered = await registerClient({
    registrationEndpoint,
    redirectUri,
    clientName: CLIENT_NAME,
    scope,
  });
  return registered.client_id;
}

export async function oauthLogin(
  input: OAuthLoginInput,
  deps: OAuthLoginDeps,
): Promise<OAuthCredential> {
  const scope = input.scope ?? OAUTH_SCOPE;
  const metadata = input.metadata ?? (await discoverMetadata(input.baseUrl, scope));
  const pkce = generatePkce();
  const state = randomState();
  // The server validates state in-handler, so a forged callback can't consume the slot.
  const server = await startCallbackServer(state, input.timeoutMs);
  try {
    const clientId = await resolveClientId(
      metadata.registration_endpoint,
      server.redirectUri,
      input.clientId,
      scope,
    );
    const authorizeUrl = buildAuthorizeUrl(metadata.authorization_endpoint, {
      response_type: "code",
      client_id: clientId,
      redirect_uri: server.redirectUri,
      code_challenge: pkce.challenge,
      code_challenge_method: "S256",
      state,
      scope,
    });

    const opened = await deps.openBrowser(authorizeUrl);
    deps.onAuthorizeUrl(authorizeUrl, opened);

    const callback = await server.waitForCallback();

    const tokens = await exchangeCode({
      tokenEndpoint: metadata.token_endpoint,
      code: callback.code,
      redirectUri: server.redirectUri,
      clientId,
      codeVerifier: pkce.verifier,
    });

    if (tokens.refresh_token === undefined) {
      throw new ConfigError("token endpoint did not return a refresh token");
    }

    return oauthCredentialFromTokens(tokens, tokens.refresh_token, clientId, scope, deps.now());
  } finally {
    server.close();
  }
}
