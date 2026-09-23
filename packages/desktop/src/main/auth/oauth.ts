import { setTimeout as delay } from "node:timers/promises";

import { createClient } from "@metabase/client/client";
import { oauthLogin } from "@metabase/client/auth/oauth-login";
import { revokeOAuthCredential } from "@metabase/client/auth/oauth-session";
import { NetworkError, TimeoutError, errorMessage } from "@metabase/client/errors";
import { discoverOAuth } from "@metabase/client/http/oauth";
import { throwIfAborted } from "@metabase/client/signal";
import { normalizeUrl } from "@metabase/client/url";

import type { OAuthCredential } from "@metabase/client/auth/credential";
import type { DiscoveryRefusal, OAuthDiscovery } from "@metabase/client/http/oauth";

import packageJson from "../../../package.json" with { type: "json" };

import { assertNever } from "../../contracts/assert-never";
import type { AuthMethod, ConnectOutcome, ConnectRequest } from "../../contracts/connection";
import type { ConnectedUser, ServerSummary, StoredCredential } from "../../contracts/settings";

import { serverSummary } from "../server-summary";

export const USER_AGENT = `metabase-rde-desktop/${packageJson.version}`;

const OAUTH_CLIENT_NAME = "Metabase RDE";

const REVOCATION_TIMEOUT_MS = 5_000;

interface ConnectDeps {
  readonly openBrowser: (url: string) => Promise<boolean>;
  readonly onAuthorizeUrl: (url: string, opened: boolean) => void;
  readonly now: () => number;
}

type ConnectedOutcome = Extract<ConnectOutcome, { kind: "connected" }>;

interface ConnectAccepted {
  readonly kind: "connected";
  readonly connected: ConnectedOutcome;
  readonly credential: StoredCredential;
}

interface ConnectRejected {
  readonly kind: "failed";
  readonly message: string;
}

type ConnectResult = ConnectAccepted | ConnectRejected;

export function connectOutcome(result: ConnectResult): ConnectOutcome {
  if (result.kind === "failed") {
    return { kind: "failed", message: result.message };
  }
  return result.connected;
}

function narrowerScopes(offered: readonly string[]): string {
  const [first] = offered;
  const counted = offered.length === 1 ? "1 narrower scope" : `${offered.length} narrower scopes`;
  return first === undefined ? counted : `${counted} such as ${first}`;
}

function refusalReason(refusal: DiscoveryRefusal): string {
  switch (refusal.kind) {
    case "status": {
      return `This Metabase answered ${refusal.status} when the app looked for its browser sign-in, so paste an API key instead.`;
    }
    case "notJson": {
      const served = refusal.contentType ?? "no content type";
      return `This Metabase answered with ${served} when the app looked for its browser sign-in, so paste an API key instead.`;
    }
    case "noFullAccessScope": {
      return `This Metabase offers browser sign-in only for ${narrowerScopes(refusal.offered)}, not the full access this app needs, so paste an API key instead.`;
    }
    default: {
      return assertNever(refusal);
    }
  }
}

export function authMethodFor(discovery: OAuthDiscovery): AuthMethod {
  if (discovery.kind === "found") {
    return { kind: "oauth" };
  }
  return { kind: "apiKey", reason: refusalReason(discovery) };
}

export async function probeAuthMethod(url: string, signal: AbortSignal): Promise<AuthMethod> {
  try {
    return authMethodFor(await discover(url, signal));
  } catch (error) {
    if (error instanceof NetworkError || error instanceof TimeoutError) {
      return {
        kind: "unreachable",
        message: `Nothing answered at ${url}. Check the address and that Metabase is running.`,
      };
    }
    return { kind: "unreachable", message: errorMessage(error) };
  }
}

function discover(url: string, signal: AbortSignal): Promise<OAuthDiscovery> {
  throwIfAborted(signal);
  return discoverOAuth(normalizeUrl(url), USER_AGENT);
}

interface ProbedConnection {
  readonly user: ConnectedUser;
  readonly server: ServerSummary;
}

async function probeConnection(
  baseUrl: string,
  credential: StoredCredential,
  signal: AbortSignal,
): Promise<ProbedConnection> {
  const client = createClient({ url: baseUrl, credential }, { userAgent: USER_AGENT, signal });
  const profile = await client.server();
  const user = await client.user.current();
  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.common_name,
      isSuperuser: user.is_superuser,
    },
    server: serverSummary(profile),
  };
}

async function acquireCredential(
  request: ConnectRequest,
  baseUrl: string,
  deps: ConnectDeps,
  signal: AbortSignal,
): Promise<StoredCredential> {
  if (request.apiKey !== null) {
    return { kind: "apiKey", apiKey: request.apiKey };
  }
  const discovery = await discover(baseUrl, signal);
  if (discovery.kind !== "found") {
    throw new Error(refusalReason(discovery));
  }
  return oauthLogin(
    {
      baseUrl,
      userAgent: USER_AGENT,
      clientName: OAUTH_CLIENT_NAME,
      metadata: discovery.metadata,
    },
    { openBrowser: deps.openBrowser, onAuthorizeUrl: deps.onAuthorizeUrl, now: deps.now },
  );
}

export async function connect(
  request: ConnectRequest,
  deps: ConnectDeps,
  signal: AbortSignal,
): Promise<ConnectResult> {
  const baseUrl = normalizeUrl(request.url);
  try {
    const credential = await acquireCredential(request, baseUrl, deps, signal);
    const probed = await probeConnection(baseUrl, credential, signal);
    return {
      kind: "connected",
      credential,
      connected: {
        kind: "connected",
        url: baseUrl,
        user: probed.user,
        server: probed.server,
        connectedAt: new Date(deps.now()).toISOString(),
      },
    };
  } catch (error) {
    return { kind: "failed", message: errorMessage(error) };
  }
}

interface CredentialRevoked {
  readonly kind: "revoked";
}

interface RevocationUnsupported {
  readonly kind: "unsupported";
}

interface RevocationFailed {
  readonly kind: "failed";
  readonly message: string;
}

type RevocationOutcome = CredentialRevoked | RevocationUnsupported | RevocationFailed;

export async function revokeCredential(
  url: string,
  credential: OAuthCredential,
): Promise<RevocationOutcome> {
  const deadline = new AbortController();
  try {
    const revoked = await Promise.race([
      revokeOAuthCredential(normalizeUrl(url), credential, USER_AGENT),
      revocationDeadline(deadline.signal),
    ]);
    return revoked ? { kind: "revoked" } : { kind: "unsupported" };
  } catch (error) {
    return { kind: "failed", message: errorMessage(error) };
  } finally {
    deadline.abort();
  }
}

async function revocationDeadline(signal: AbortSignal): Promise<never> {
  await delay(REVOCATION_TIMEOUT_MS, undefined, { signal });
  throw new Error(`revocation did not answer within ${REVOCATION_TIMEOUT_MS} ms`);
}
