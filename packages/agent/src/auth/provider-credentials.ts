import { AuthStorage, type AuthStorageBackend } from "@earendil-works/pi-coding-agent";
import type { SecretStore } from "./secret-store";

// pi's backend contract: the callback is handed the stored blob and returns a replacement in `next`
// when it changed. pi does not export the result type.
interface LockResult<T> {
  result: T;
  next?: string;
}

// Every pi credential — the `/login` API key, an OAuth token and its refreshes — is one JSON blob in
// the OS keychain, never a file. The read-modify-write is not locked across processes (a keychain
// has no lock to take): two mb-agents refreshing the same OAuth token concurrently can leave the
// loser's rotation stored, which the next request recovers by refreshing again.
class SecretStoreBackend implements AuthStorageBackend {
  private readonly store: SecretStore;

  constructor(store: SecretStore) {
    this.store = store;
  }

  withLock<T>(fn: (current: string | undefined) => LockResult<T>): T {
    return this.persist(fn(this.current()));
  }

  async withLockAsync<T>(fn: (current: string | undefined) => Promise<LockResult<T>>): Promise<T> {
    return this.persist(await fn(this.current()));
  }

  private current(): string | undefined {
    return this.store.read() ?? undefined;
  }

  private persist<T>(outcome: LockResult<T>): T {
    if (outcome.next !== undefined) {
      this.store.write(outcome.next);
    }
    return outcome.result;
  }
}

export interface ProviderCredentials {
  authStorage: AuthStorage;
  // False when the host has no usable keychain: `/login` still authenticates the session, but the
  // credential is gone at exit.
  persistent: boolean;
}

export function createProviderCredentials(store: SecretStore | null): ProviderCredentials {
  if (store === null) {
    return { authStorage: AuthStorage.inMemory(), persistent: false };
  }
  return { authStorage: AuthStorage.fromStorage(new SecretStoreBackend(store)), persistent: true };
}
