import type { Credential, CredentialRefresher } from "@metabase/client/auth/credential";
import { ConfigError } from "@metabase/client/errors";
import { normalizeUrl } from "@metabase/client/url";

import { createBrokerRefresher, fetchBrokerCredential, readBrokerTarget } from "./auth-broker";
import {
  ENV_API_KEY,
  ENV_AUTH_BROKER,
  ENV_SKIP_PREFLIGHT,
  ENV_URL,
  ENV_WORKTREE_ID,
  readEnv,
} from "./env";

export const SKIP_PREFLIGHT_ENV = ENV_SKIP_PREFLIGHT;

export function isPreflightSkipped(): boolean {
  return readEnv(ENV_SKIP_PREFLIGHT) === "1";
}

export interface ResolvedConfig {
  url: string;
  credential: Credential;
  // `null` when the credential cannot be renewed: the client then reports a 401 as it stands.
  refreshCredential: CredentialRefresher | null;
  // The remote-sync worktree every request works inside, or `null` for the main app.
  worktreeId: number | null;
}

export const NO_CREDENTIAL_MESSAGE = `no Metabase credential; run inside Metabase RDE, or set ${ENV_URL} and ${ENV_API_KEY}`;

interface ResolveConfigOptions {
  signal: AbortSignal;
}

function readOptionalEnv(name: string): string | null {
  const value = readEnv(name);
  return value === undefined || value === "" ? null : value;
}

const POSITIVE_INTEGER_PATTERN = /^[1-9]\d*$/;

function readWorktreeId(): number | null {
  const value = readOptionalEnv(ENV_WORKTREE_ID);
  if (value === null) {
    return null;
  }
  const id = Number(value);
  if (!POSITIVE_INTEGER_PATTERN.test(value) || !Number.isSafeInteger(id)) {
    throw new ConfigError(`${ENV_WORKTREE_ID} must be a positive integer, got "${value}"`);
  }
  return id;
}

// The broker first, the environment's own key second, nothing third. `MB_URL` names the server
// either way; with the broker it must agree with the server the broker serves, so a session
// pointed at one Metabase never sends its token to another.
export async function resolveConfig(options: ResolveConfigOptions): Promise<ResolvedConfig> {
  const envUrl = readOptionalEnv(ENV_URL);
  const worktreeId = readWorktreeId();
  const broker = readBrokerTarget();
  if (broker !== null) {
    const granted = await fetchBrokerCredential(broker, options);
    if (envUrl !== null && normalizeUrl(envUrl) !== granted.url) {
      throw new ConfigError(
        `${ENV_URL} is ${normalizeUrl(envUrl)} but the ${ENV_AUTH_BROKER} credential is for ${granted.url}`,
      );
    }
    return {
      url: granted.url,
      credential: granted.credential,
      refreshCredential: createBrokerRefresher(broker, options),
      worktreeId,
    };
  }
  const apiKey = readOptionalEnv(ENV_API_KEY);
  if (envUrl === null || apiKey === null) {
    throw new ConfigError(NO_CREDENTIAL_MESSAGE);
  }
  return {
    url: normalizeUrl(envUrl),
    credential: { kind: "apiKey", apiKey },
    refreshCredential: null,
    worktreeId,
  };
}
