export interface KeyringMockState {
  store: Map<string, string>;
  controls: { broken: boolean };
}

export interface KeyringMockModule {
  Entry: new (service: string, account: string) => KeyringMockEntry;
}

interface KeyringMockEntry {
  service: string;
  account: string;
  setPassword(value: string): void;
  getPassword(): string | null;
  deletePassword(): boolean;
}

export function createKeyringMockModule(state: KeyringMockState): KeyringMockModule {
  return {
    Entry: class {
      service: string;
      account: string;
      constructor(service: string, account: string) {
        this.service = service;
        this.account = account;
      }
      setPassword(value: string): void {
        if (state.controls.broken) {
          throw new Error("keyring unavailable");
        }
        state.store.set(`${this.service}:${this.account}`, value);
      }
      getPassword(): string | null {
        if (state.controls.broken) {
          throw new Error("keyring unavailable");
        }
        return state.store.get(`${this.service}:${this.account}`) ?? null;
      }
      deletePassword(): boolean {
        if (state.controls.broken) {
          throw new Error("keyring unavailable");
        }
        return state.store.delete(`${this.service}:${this.account}`);
      }
    },
  };
}
