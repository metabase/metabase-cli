import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { Entry } from "@napi-rs/keyring";
import { z } from "zod";

import { parseJson } from "../../runtime/json";
import { isNotFoundError } from "../errors";

const CredentialsFileSchema = z.record(z.string(), z.string());

const KEYRING_SERVICE = "metabase-cli";
const CREDENTIALS_FILE = "credentials.json";
export const DEFAULT_PROFILE = "default";

const CREDENTIALS_FILE_MODE = 0o600;
const CREDENTIALS_DIR_MODE = 0o700;

export type ProfileUrlAccount = `profile:${string}:url`;
export type ProfileApiKeyAccount = `profile:${string}:apiKey`;
export type LicenseAccount = "license";
export type CredentialAccount = ProfileUrlAccount | ProfileApiKeyAccount | LicenseAccount;

export const account = {
  profileUrl: (profile: string): ProfileUrlAccount => `profile:${profile}:url`,
  profileApiKey: (profile: string): ProfileApiKeyAccount => `profile:${profile}:apiKey`,
  license: "license",
} as const;

export interface KeyringLocation {
  backend: "keyring";
  service: string;
  account: CredentialAccount;
}

export interface FileLocation {
  backend: "file";
  path: string;
  account: CredentialAccount;
}

export type CredentialLocation = KeyringLocation | FileLocation;

export interface Profile {
  url: string;
  apiKey: string;
}

function configDir(): string {
  if (process.platform === "win32") {
    const appData = process.env["APPDATA"] ?? join(homedir(), "AppData", "Roaming");
    return join(appData, "metabase-cli");
  }
  const xdg = process.env["XDG_CONFIG_HOME"] ?? join(homedir(), ".config");
  return join(xdg, "metabase-cli");
}

export function fallbackFilePath(): string {
  return join(configDir(), CREDENTIALS_FILE);
}

function keyringEnabled(): boolean {
  return process.env["METABASE_CLI_DISABLE_KEYRING"] !== "1";
}

// @napi-rs/keyring surfaces every backend failure (no service, locked vault,
// permission denied, ambiguous entry, programming-side `Invalid`) as a plain
// Error with a human message and no machine-readable discriminator. We can't
// tell a recoverable backend issue from a real bug, and the design choice is
// graceful degradation to the file backend either way — so every throw routes
// to the fallback, deliberately.
function trySetKeyring(key: CredentialAccount, value: string): boolean {
  if (!keyringEnabled()) {
    return false;
  }
  try {
    new Entry(KEYRING_SERVICE, key).setPassword(value);
    return true;
  } catch {
    return false;
  }
}

function tryReadKeyring(key: CredentialAccount): string | null | undefined {
  if (!keyringEnabled()) {
    return undefined;
  }
  try {
    return new Entry(KEYRING_SERVICE, key).getPassword();
  } catch {
    return undefined;
  }
}

function tryRemoveKeyring(key: CredentialAccount): boolean | undefined {
  if (!keyringEnabled()) {
    return undefined;
  }
  try {
    return new Entry(KEYRING_SERVICE, key).deletePassword();
  } catch {
    return undefined;
  }
}

async function readFileStore(): Promise<Record<string, string>> {
  const path = fallbackFilePath();
  let raw: string;
  try {
    raw = await fs.readFile(path, "utf8");
  } catch (error) {
    if (isNotFoundError(error)) {
      return {};
    }
    throw error;
  }
  return parseJson(raw, CredentialsFileSchema, { source: path });
}

async function writeFileStore(store: Record<string, string>): Promise<void> {
  const path = fallbackFilePath();
  await fs.mkdir(dirname(path), { recursive: true, mode: CREDENTIALS_DIR_MODE });
  await fs.writeFile(path, JSON.stringify(store, null, 2) + "\n", { mode: CREDENTIALS_FILE_MODE });
  if (process.platform !== "win32") {
    await fs.chmod(path, CREDENTIALS_FILE_MODE);
  }
}

async function setFile(key: CredentialAccount, value: string): Promise<void> {
  const store = await readFileStore();
  store[key] = value;
  await writeFileStore(store);
}

async function readFromFile(key: CredentialAccount): Promise<string | null> {
  const store = await readFileStore();
  return store[key] ?? null;
}

async function removeFromFile(key: CredentialAccount): Promise<boolean> {
  const store = await readFileStore();
  if (!(key in store)) {
    return false;
  }
  delete store[key];
  if (Object.keys(store).length === 0) {
    await fs.unlink(fallbackFilePath()).catch(() => undefined);
  } else {
    await writeFileStore(store);
  }
  return true;
}

export const credentials = {
  async set(key: CredentialAccount, value: string): Promise<CredentialLocation> {
    if (trySetKeyring(key, value)) {
      await removeFromFile(key).catch(() => undefined);
      return { backend: "keyring", service: KEYRING_SERVICE, account: key };
    }
    await setFile(key, value);
    return { backend: "file", path: fallbackFilePath(), account: key };
  },

  async read(key: CredentialAccount): Promise<string | null> {
    const fromKeyring = tryReadKeyring(key);
    if (fromKeyring !== undefined) {
      return fromKeyring;
    }
    return readFromFile(key);
  },

  async has(key: CredentialAccount): Promise<boolean> {
    return (await credentials.read(key)) !== null;
  },

  async remove(key: CredentialAccount): Promise<boolean> {
    const fromKeyring = tryRemoveKeyring(key);
    const fromFile = await removeFromFile(key).catch(() => false);
    if (fromKeyring === undefined) {
      return fromFile;
    }
    return fromKeyring || fromFile;
  },

  async location(key: CredentialAccount): Promise<CredentialLocation> {
    if (tryReadKeyring(key) !== undefined) {
      return { backend: "keyring", service: KEYRING_SERVICE, account: key };
    }
    return { backend: "file", path: fallbackFilePath(), account: key };
  },
};

export async function readProfile(name: string = DEFAULT_PROFILE): Promise<Profile | null> {
  const [url, apiKey] = await Promise.all([
    credentials.read(account.profileUrl(name)),
    credentials.read(account.profileApiKey(name)),
  ]);
  if (!url || !apiKey) {
    return null;
  }
  return { url, apiKey };
}

export async function writeProfile(
  profile: Profile,
  name: string = DEFAULT_PROFILE,
): Promise<CredentialLocation> {
  await credentials.set(account.profileUrl(name), profile.url);
  return credentials.set(account.profileApiKey(name), profile.apiKey);
}

export async function clearProfile(name: string = DEFAULT_PROFILE): Promise<boolean> {
  const removedUrl = await credentials.remove(account.profileUrl(name));
  const removedKey = await credentials.remove(account.profileApiKey(name));
  return removedUrl || removedKey;
}

export async function readLicense(): Promise<string | null> {
  return credentials.read(account.license);
}

export async function writeLicense(token: string): Promise<CredentialLocation> {
  return credentials.set(account.license, token);
}

export async function clearLicense(): Promise<boolean> {
  return credentials.remove(account.license);
}
