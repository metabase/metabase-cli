import { ConfigError } from "../errors";
import {
  discoverLoginMetadata,
  exchangeCode,
  OAUTH_SCOPE,
  registerClient,
  type OAuthServerMetadata,
} from "../http/oauth";

import { startCallbackServer, type CallbackServer } from "./callback-server";
import { oauthCredentialFromTokens, type OAuthCredential } from "./credential";
import { parsePastedRedirect } from "./pasted-redirect";
import { generatePkce, randomState } from "./pkce";

export interface OAuthLoginInput {
  baseUrl: string;
  userAgent: string;
  // Sent as `client_name` during dynamic client registration; the user's Metabase persists it as
  // the name of the registered OAuth client.
  clientName: string;
  // Discovery document already fetched by the caller (login probes it to pick the auth method);
  // when omitted it is discovered here.
  metadata?: OAuthServerMetadata;
  clientId?: string;
  timeoutMs?: number;
}

// What a paste reader is handed: `validate` returns why an input cannot complete this login (or
// null when it can), so a reader can re-ask on a bad paste; `signal` aborts once the loopback
// redirect has won the race and the paste is no longer wanted.
export interface PastedRedirectPrompt {
  validate: (input: string) => string | null;
  signal: AbortSignal;
}

export type PastedRedirectReader = (prompt: PastedRedirectPrompt) => Promise<string>;

export interface OAuthLoginDeps {
  openBrowser: (url: string) => Promise<boolean>;
  onAuthorizeUrl: (url: string, opened: boolean) => void;
  now: () => number;
  // Consulted only when `openBrowser` reports it did not open one: the browser that completes
  // consent may then be on another machine, whose redirect to this machine's loopback never
  // arrives. The user pastes the URL that browser landed on instead, and whichever of the paste and
  // the loopback redirect comes first completes the login.
  readPastedRedirect?: PastedRedirectReader;
}

function buildAuthorizeUrl(authorizationEndpoint: string, params: Record<string, string>): string {
  // RFC 6749 §3.1 allows the authorization endpoint to carry its own query component.
  const separator = authorizationEndpoint.includes("?") ? "&" : "?";
  return `${authorizationEndpoint}${separator}${new URLSearchParams(params).toString()}`;
}

async function resolveClientId(
  input: OAuthLoginInput,
  registrationEndpoint: string | undefined,
  redirectUri: string,
): Promise<string> {
  if (input.clientId !== undefined) {
    return input.clientId;
  }
  if (registrationEndpoint === undefined) {
    throw new ConfigError(
      "this Metabase has dynamic client registration disabled; pass clientId with a pre-registered native client",
    );
  }
  const registered = await registerClient({
    registrationEndpoint,
    redirectUri,
    clientName: input.clientName,
    userAgent: input.userAgent,
  });
  return registered.client_id;
}

export async function oauthLogin(
  input: OAuthLoginInput,
  deps: OAuthLoginDeps,
): Promise<OAuthCredential> {
  const metadata = input.metadata ?? (await discoverLoginMetadata(input.baseUrl, input.userAgent));
  const pkce = generatePkce();
  const state = randomState();
  // The server validates state in-handler, so a forged callback can't consume the slot.
  const server = await startCallbackServer(state, input.timeoutMs);
  try {
    const clientId = await resolveClientId(
      input,
      metadata.registration_endpoint,
      server.redirectUri,
    );
    const authorizeUrl = buildAuthorizeUrl(metadata.authorization_endpoint, {
      response_type: "code",
      client_id: clientId,
      redirect_uri: server.redirectUri,
      code_challenge: pkce.challenge,
      code_challenge_method: "S256",
      state,
      scope: OAUTH_SCOPE,
    });

    const opened = await deps.openBrowser(authorizeUrl);
    deps.onAuthorizeUrl(authorizeUrl, opened);

    const code = await authorizationCode(
      server,
      state,
      opened ? undefined : deps.readPastedRedirect,
    );

    const tokens = await exchangeCode({
      tokenEndpoint: metadata.token_endpoint,
      code,
      redirectUri: server.redirectUri,
      clientId,
      codeVerifier: pkce.verifier,
      userAgent: input.userAgent,
    });

    if (tokens.refresh_token === undefined) {
      throw new ConfigError("token endpoint did not return a refresh token");
    }

    return oauthCredentialFromTokens(tokens, tokens.refresh_token, clientId, deps.now());
  } finally {
    server.close();
  }
}

async function authorizationCode(
  server: CallbackServer,
  state: string,
  readPastedRedirect: PastedRedirectReader | undefined,
): Promise<string> {
  if (readPastedRedirect === undefined) {
    return (await server.waitForCallback()).code;
  }
  const pasteAbort = new AbortController();
  try {
    return await Promise.race([
      server.waitForCallback().then((callback) => callback.code),
      readPastedCode(readPastedRedirect, state, pasteAbort.signal),
    ]);
  } finally {
    pasteAbort.abort();
  }
}

async function readPastedCode(
  readPastedRedirect: PastedRedirectReader,
  state: string,
  signal: AbortSignal,
): Promise<string> {
  const input = await readPastedRedirect({
    validate: (candidate) => {
      const parsed = parsePastedRedirect(candidate, state);
      return parsed.kind === "invalid" ? parsed.reason : null;
    },
    signal,
  });
  const parsed = parsePastedRedirect(input, state);
  if (parsed.kind === "denied") {
    throw parsed.error;
  }
  if (parsed.kind === "invalid") {
    throw new ConfigError(parsed.reason);
  }
  return parsed.code;
}
