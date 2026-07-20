import { ENV_PROFILE_STORE, readEnv } from "../env";
import { ConfigError } from "../errors";

// A profile store is a namespace for credential sets: its own keychain service and its own profiles
// file. `mb` uses the default one; an agent embedding this CLI points `MB_PROFILE_STORE` at its own,
// so the credential it acts under is never the one a human logged in at the terminal — and neither
// can clear or overwrite the other's.
export const DEFAULT_PROFILE_STORE = "cli";

const KEYRING_SERVICE_PREFIX = "metabase-";
const PROFILES_FILE = "profiles.json";

// A store id names a keychain service and a file, so it may not carry a path separator, a space, or
// anything else that would let a caller reach outside the config directory.
const STORE_ID_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;

export function resolveProfileStore(): string {
  const configured = readEnv(ENV_PROFILE_STORE);
  if (configured === undefined || configured === "") {
    return DEFAULT_PROFILE_STORE;
  }
  if (!STORE_ID_PATTERN.test(configured)) {
    throw new ConfigError(
      `${ENV_PROFILE_STORE} must be a lowercase name like "agent" (letters, digits and dashes, starting with a letter), not "${configured}".`,
    );
  }
  return configured;
}

export function keyringService(store: string): string {
  return KEYRING_SERVICE_PREFIX + store;
}

// The default store degrades to a plaintext `profiles.json` when the OS keychain is unavailable —
// a CLI must still authenticate on a headless box with no vault. Every other store refuses: an
// embedder that asked for its own store asked for a secret boundary, and silently writing its
// credential to disk would be the one failure mode it cannot see. Those callers have `MB_URL` /
// `MB_API_KEY` for hosts with no keychain.
export function keyringRequired(store: string): boolean {
  return store !== DEFAULT_PROFILE_STORE;
}

export function profilesFileName(store: string): string {
  return store === DEFAULT_PROFILE_STORE ? PROFILES_FILE : `profiles.${store}.json`;
}
