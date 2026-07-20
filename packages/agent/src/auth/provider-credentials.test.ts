import { describe, expect, it } from "vitest";
import { createProviderCredentials } from "./provider-credentials";
import type { SecretStore } from "./secret-store";

interface FakeStore extends SecretStore {
  value: string | null;
}

function fakeStore(initial: string | null = null): FakeStore {
  return {
    value: initial,
    read() {
      return this.value;
    },
    write(next: string) {
      this.value = next;
    },
  };
}

describe("createProviderCredentials", () => {
  it("writes a credential into the secret store as pi's own blob", () => {
    const store = fakeStore();
    const { authStorage, persistent } = createProviderCredentials(store);

    authStorage.set("anthropic", { type: "api_key", key: "sk-ant-stored" });

    expect(persistent).toBe(true);
    expect(store.value).toBe(
      JSON.stringify({ anthropic: { type: "api_key", key: "sk-ant-stored" } }, null, 2),
    );
  });

  it("reads back a credential a previous process stored", async () => {
    const store = fakeStore(JSON.stringify({ zai: { type: "api_key", key: "zai-stored" } }));

    const { authStorage } = createProviderCredentials(store);

    expect(authStorage.hasAuth("zai")).toBe(true);
    expect(await authStorage.getApiKey("zai")).toBe("zai-stored");
  });

  it("keeps the other providers when one is removed", () => {
    const store = fakeStore(
      JSON.stringify({
        anthropic: { type: "api_key", key: "sk-ant-stored" },
        zai: { type: "api_key", key: "zai-stored" },
      }),
    );
    const { authStorage } = createProviderCredentials(store);

    authStorage.remove("anthropic");

    expect(authStorage.getAll()).toEqual({ zai: { type: "api_key", key: "zai-stored" } });
    expect(createProviderCredentials(store).authStorage.getAll()).toEqual({
      zai: { type: "api_key", key: "zai-stored" },
    });
  });

  it("holds credentials in memory when the host has no keychain", () => {
    const { authStorage, persistent } = createProviderCredentials(null);

    authStorage.set("anthropic", { type: "api_key", key: "sk-ant-session" });

    expect(persistent).toBe(false);
    expect(authStorage.getAll()).toEqual({ anthropic: { type: "api_key", key: "sk-ant-session" } });
  });
});
