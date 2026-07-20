import { Entry } from "@napi-rs/keyring";
import { errorMessage } from "@metabase/cli/errors";
import { AGENT_KEYRING_SERVICE } from "./store";

export const ENV_DISABLE_KEYRING = "MB_AGENT_DISABLE_KEYRING";

// The model provider's key sits beside the agent's Metabase profiles, in the agent's keychain
// service. It is not a Metabase credential, so it is not a profile: one account holds pi's own blob.
const KEYRING_SERVICE = AGENT_KEYRING_SERVICE;
const KEYRING_ACCOUNT = "provider-credentials";

// A single named secret: the whole provider-credential blob, read and written as one string.
export interface SecretStore {
  read(): string | null;
  write(value: string): void;
}

export class SecretStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretStoreError";
  }
}

// `null` means the host has no usable keychain, and provider credentials then live only in memory.
// @napi-rs/keyring reports every backend failure — no vault, locked vault, permission denied — as a
// plain Error with no machine-readable discriminator, so a probe read is the only way to tell an
// unusable keychain from an empty one.
export function keyringSecretStore(): SecretStore | null {
  if (process.env[ENV_DISABLE_KEYRING] === "1") {
    return null;
  }
  const entry = new Entry(KEYRING_SERVICE, KEYRING_ACCOUNT);
  try {
    entry.getPassword();
  } catch {
    return null;
  }
  return {
    read() {
      try {
        return entry.getPassword();
      } catch {
        return null;
      }
    },
    write(value) {
      try {
        entry.setPassword(value);
      } catch (error) {
        throw new SecretStoreError(
          `Could not write provider credentials to the OS keychain (${KEYRING_SERVICE}): ${errorMessage(error)}`,
        );
      }
    },
  };
}
