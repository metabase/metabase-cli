import { afterEach, expect, test } from "vitest";
import { ENV_DISABLE_KEYRING, keyringSecretStore } from "./secret-store";

const inherited = process.env[ENV_DISABLE_KEYRING];

afterEach(() => {
  if (inherited === undefined) {
    delete process.env[ENV_DISABLE_KEYRING];
  } else {
    process.env[ENV_DISABLE_KEYRING] = inherited;
  }
});

test("has no store to offer when the keychain is switched off", () => {
  process.env[ENV_DISABLE_KEYRING] = "1";

  expect(keyringSecretStore()).toBeNull();
});
