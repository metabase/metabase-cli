import { z } from "zod";

import type { Credential, CredentialRefresher } from "@metabase/client/auth/credential";
import { ConfigError, errorMessage } from "@metabase/client/errors";
import { parseJson } from "@metabase/client/json";
import { normalizeUrl } from "@metabase/client/url";

import { ENV_AUTH_BROKER, ENV_AUTH_BROKER_TOKEN, readEnv } from "./env";

// The broker's contract is versioned in the path, so a CLI and an app that disagree fail on a 404
// rather than on a shape.
const CREDENTIAL_PATH = "/v1/credential";
const REFRESH_PATH = "/v1/credential/refresh";
const BROKER_TIMEOUT_MS = 10_000;
const UNAUTHORIZED_STATUS = 401;
const UNAVAILABLE_STATUS = 503;

const BrokerOAuthCredential = z.object({
  kind: z.literal("oauth"),
  accessToken: z.string().min(1),
  expiresAt: z.iso.datetime(),
});

const BrokerApiKeyCredential = z.object({
  kind: z.literal("apiKey"),
  apiKey: z.string().min(1),
});

const BrokerGrant = z.object({
  url: z.string().min(1),
  credential: z.discriminatedUnion("kind", [BrokerOAuthCredential, BrokerApiKeyCredential]),
});
type BrokerGrant = z.infer<typeof BrokerGrant>;

const BrokerRefusal = z.object({ reason: z.string() });

export interface BrokerTarget {
  url: string;
  token: string;
}

interface BrokerCredential {
  url: string;
  credential: Credential;
}

interface BrokerRequestOptions {
  signal: AbortSignal;
}

// Both variables or neither: the app sets them together, so one without the other is a broken
// session environment rather than a developer running the CLI by hand.
export function readBrokerTarget(): BrokerTarget | null {
  const url = readEnv(ENV_AUTH_BROKER);
  const token = readEnv(ENV_AUTH_BROKER_TOKEN);
  const hasUrl = url !== undefined && url !== "";
  const hasToken = token !== undefined && token !== "";
  if (!hasUrl && !hasToken) {
    return null;
  }
  if (!hasUrl || !hasToken) {
    throw new ConfigError(
      `${ENV_AUTH_BROKER} and ${ENV_AUTH_BROKER_TOKEN} must be set together (one of them is missing)`,
    );
  }
  return { url: normalizeUrl(url), token };
}

// The credential kinds are the broker's own; the client sees a host-renewed bearer for the OAuth
// one because the refresh token never leaves the app.
function toClientCredential(grant: BrokerGrant): Credential {
  const { credential } = grant;
  if (credential.kind === "apiKey") {
    return { kind: "apiKey", apiKey: credential.apiKey };
  }
  return { kind: "bearer", accessToken: credential.accessToken, expiresAt: credential.expiresAt };
}

async function requestBroker(
  target: BrokerTarget,
  path: string,
  method: "GET" | "POST",
  options: BrokerRequestOptions,
): Promise<BrokerCredential> {
  const url = target.url + path;
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: { authorization: `Bearer ${target.token}`, accept: "application/json" },
      signal: AbortSignal.any([options.signal, AbortSignal.timeout(BROKER_TIMEOUT_MS)]),
    });
  } catch (error) {
    throw new ConfigError(
      `could not reach the Metabase RDE broker at ${target.url}: ${errorMessage(error)}`,
    );
  }
  const body = await response.text();
  if (response.status === UNAUTHORIZED_STATUS) {
    throw new ConfigError("the Metabase RDE broker rejected this session's token (401)");
  }
  if (response.status === UNAVAILABLE_STATUS) {
    const refusal = parseJson(body, BrokerRefusal, { source: url });
    throw new ConfigError(`Metabase RDE has no credential for this session: ${refusal.reason}`);
  }
  if (!response.ok) {
    throw new ConfigError(
      `the Metabase RDE broker answered ${response.status} for ${method} ${path}`,
    );
  }
  const grant = parseJson(body, BrokerGrant, { source: url });
  return { url: normalizeUrl(grant.url), credential: toClientCredential(grant) };
}

export function fetchBrokerCredential(
  target: BrokerTarget,
  options: BrokerRequestOptions,
): Promise<BrokerCredential> {
  return requestBroker(target, CREDENTIAL_PATH, "GET", options);
}

// Handed to the client, which calls it once per 401 and replays the request with what comes back.
export function createBrokerRefresher(
  target: BrokerTarget,
  options: BrokerRequestOptions,
): CredentialRefresher {
  return async () => {
    const refreshed = await requestBroker(target, REFRESH_PATH, "POST", options);
    return refreshed.credential;
  };
}
