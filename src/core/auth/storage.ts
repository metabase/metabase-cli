import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";

import { Entry } from "@napi-rs/keyring";

import { parseJsonResult } from "../../runtime/json";
import { isNotFoundError, ValidationError } from "../errors";
import { configDir } from "../paths";
import type { ServerInfo } from "../version/probe";

import {
  ProfileLastFailure,
  ProfileLastProbe,
  ProfilesFile,
  type ProbedUser,
  type ProfileFailureKind,
  type ProfileRecord,
} from "./profile-record";

const KEYRING_SERVICE = "metabase-cli";
const PROFILES_FILE = "profiles.json";
const LEGACY_CREDENTIALS_FILE = "credentials.json";
const LEGACY_REJECTIONS_FILE = "rejections.json";
const PROFILES_FILE_MODE = 0o600;
const PROFILES_DIR_MODE = 0o700;

export const DEFAULT_PROFILE = "default";

export const LEGACY_STORAGE_NOTICE =
  "Old profile storage detected and ignored; re-run `mb auth login` for each profile.";

export type ProfileApiKeyAccount = `profile:${string}:apiKey`;
export type LicenseAccount = "license";
export type CredentialAccount = ProfileApiKeyAccount | LicenseAccount;

export const account = {
  profileApiKey: (profile: string): ProfileApiKeyAccount => `profile:${profile}:apiKey`,
  license: "license",
} as const;

export interface KeyringLocation {
  backend: "keyring";
  service: string;
  account: CredentialAccount;
}

export type KeyringFallbackReason = "disabled" | "unavailable";

export type KeyringFallbackSubject = "credentials" | "license";

export interface FileLocation {
  backend: "file";
  path: string;
  account: CredentialAccount;
  reason: KeyringFallbackReason;
}

export type CredentialLocation = KeyringLocation | FileLocation;

export interface Profile {
  url: string;
  apiKey: string;
}

export interface ProbeWriteInput {
  user: ProbedUser;
  server: ServerInfo;
}

let legacyWarningPending = false;

export function profilesFilePath(): string {
  return join(configDir(), PROFILES_FILE);
}

export function consumeLegacyStorageWarning(): string | null {
  if (!legacyWarningPending) {
    return null;
  }
  legacyWarningPending = false;
  return LEGACY_STORAGE_NOTICE;
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

async function readProfilesFile(): Promise<ProfilesFile> {
  const path = profilesFilePath();
  let raw: string;
  try {
    raw = await fs.readFile(path, "utf8");
  } catch (error) {
    if (isNotFoundError(error)) {
      await detectLegacyArtifacts();
      return { profiles: [], license: null };
    }
    throw error;
  }
  const parsed = parseJsonResult(raw, ProfilesFile, { source: path });
  if (parsed.ok) {
    return parsed.value;
  }
  if (parsed.error instanceof ValidationError) {
    legacyWarningPending = true;
    return { profiles: [], license: null };
  }
  throw parsed.error;
}

async function detectLegacyArtifacts(): Promise<void> {
  const legacyCredentials = join(configDir(), LEGACY_CREDENTIALS_FILE);
  const legacyRejections = join(configDir(), LEGACY_REJECTIONS_FILE);
  const [credentialsExists, rejectionsExists] = await Promise.all([
    fileExists(legacyCredentials),
    fileExists(legacyRejections),
  ]);
  if (credentialsExists || rejectionsExists) {
    legacyWarningPending = true;
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

async function writeProfilesFile(file: ProfilesFile): Promise<void> {
  const path = profilesFilePath();
  if (file.profiles.length === 0 && file.license === null) {
    await fs.unlink(path).catch(() => undefined);
    await cleanupLegacyFiles();
    return;
  }
  await fs.mkdir(dirname(path), { recursive: true, mode: PROFILES_DIR_MODE });
  await fs.writeFile(path, JSON.stringify(file, null, 2) + "\n", { mode: PROFILES_FILE_MODE });
  if (process.platform !== "win32") {
    await fs.chmod(path, PROFILES_FILE_MODE);
  }
  await cleanupLegacyFiles();
}

async function cleanupLegacyFiles(): Promise<void> {
  await Promise.all([
    fs.unlink(join(configDir(), LEGACY_CREDENTIALS_FILE)).catch(() => undefined),
    fs.unlink(join(configDir(), LEGACY_REJECTIONS_FILE)).catch(() => undefined),
  ]);
}

function findRecord(file: ProfilesFile, name: string): ProfileRecord | null {
  return file.profiles.find((entry) => entry.name === name) ?? null;
}

function fileLocation(key: CredentialAccount): FileLocation {
  return {
    backend: "file",
    path: profilesFilePath(),
    account: key,
    reason: keyringEnabled() ? "unavailable" : "disabled",
  };
}

export function keyringFallbackWarning(
  location: FileLocation,
  subject: KeyringFallbackSubject,
): string {
  const cause =
    location.reason === "disabled"
      ? "OS keychain disabled via METABASE_CLI_DISABLE_KEYRING"
      : "OS keychain unavailable";
  return `warning: ${cause}; ${subject} stored as plaintext at ${location.path}`;
}

async function persistApiKey(name: string, apiKey: string): Promise<CredentialLocation> {
  const key = account.profileApiKey(name);
  if (trySetKeyring(key, apiKey)) {
    return { backend: "keyring", service: KEYRING_SERVICE, account: key };
  }
  return fileLocation(key);
}

export async function readProfile(name: string = DEFAULT_PROFILE): Promise<Profile | null> {
  const file = await readProfilesFile();
  const record = findRecord(file, name);
  if (record === null) {
    return null;
  }
  const apiKey = await resolveApiKey(record);
  if (apiKey === null) {
    return null;
  }
  return { url: record.url, apiKey };
}

async function resolveApiKey(record: ProfileRecord): Promise<string | null> {
  const fromKeyring = tryReadKeyring(account.profileApiKey(record.name));
  if (typeof fromKeyring === "string") {
    return fromKeyring;
  }
  return record.apiKey;
}

export async function readProfileRecord(
  name: string = DEFAULT_PROFILE,
): Promise<ProfileRecord | null> {
  const file = await readProfilesFile();
  return findRecord(file, name);
}

export async function listProfileRecords(): Promise<ProfileRecord[]> {
  const file = await readProfilesFile();
  return file.profiles;
}

export async function listProfileNames(): Promise<string[]> {
  const file = await readProfilesFile();
  return file.profiles.map((entry) => entry.name);
}

export async function writeProfile(
  profile: Profile,
  name: string = DEFAULT_PROFILE,
): Promise<CredentialLocation> {
  const location = await persistApiKey(name, profile.apiKey);
  const inlineApiKey = location.backend === "file" ? profile.apiKey : null;

  const file = await readProfilesFile();
  const existing = findRecord(file, name);
  const updated: ProfileRecord =
    existing === null
      ? {
          name,
          url: profile.url,
          apiKey: inlineApiKey,
          lastProbe: null,
          lastFailure: null,
        }
      : { ...existing, url: profile.url, apiKey: inlineApiKey };
  const profiles =
    existing === null
      ? [...file.profiles, updated]
      : file.profiles.map((entry) => (entry.name === name ? updated : entry));
  await writeProfilesFile({ ...file, profiles });
  return location;
}

export async function writeProbeResult(
  name: string,
  input: ProbeWriteInput,
): Promise<ProfileLastProbe | null> {
  const probe = ProfileLastProbe.parse({
    at: new Date().toISOString(),
    version: input.server.version,
    tokenFeatures: input.server.tokenFeatures,
    user: input.user,
  });
  const file = await readProfilesFile();
  const existing = findRecord(file, name);
  if (existing === null) {
    return null;
  }
  const profiles = file.profiles.map((entry) =>
    entry.name === name ? { ...entry, lastProbe: probe, lastFailure: null } : entry,
  );
  await writeProfilesFile({ ...file, profiles });
  return probe;
}

export interface ProbeFailureInput {
  kind: ProfileFailureKind;
  reason: string;
}

export async function writeProbeFailure(
  name: string,
  input: ProbeFailureInput,
): Promise<ProfileLastFailure | null> {
  const failure = ProfileLastFailure.parse({
    at: new Date().toISOString(),
    kind: input.kind,
    reason: input.reason,
  });
  const file = await readProfilesFile();
  const existing = findRecord(file, name);
  if (existing === null) {
    return null;
  }
  const profiles = file.profiles.map((entry) =>
    entry.name === name ? { ...entry, lastFailure: failure } : entry,
  );
  await writeProfilesFile({ ...file, profiles });
  return failure;
}

export async function clearProfile(name: string = DEFAULT_PROFILE): Promise<boolean> {
  tryRemoveKeyring(account.profileApiKey(name));
  const file = await readProfilesFile();
  const existing = findRecord(file, name);
  if (existing === null) {
    return false;
  }
  await writeProfilesFile({
    ...file,
    profiles: file.profiles.filter((entry) => entry.name !== name),
  });
  return true;
}

export async function readLicense(): Promise<string | null> {
  const fromKeyring = tryReadKeyring(account.license);
  if (typeof fromKeyring === "string") {
    return fromKeyring;
  }
  const file = await readProfilesFile();
  return file.license;
}

export async function writeLicense(token: string): Promise<CredentialLocation> {
  const key = account.license;
  const file = await readProfilesFile();
  if (trySetKeyring(key, token)) {
    if (file.license !== null) {
      await writeProfilesFile({ ...file, license: null });
    }
    return { backend: "keyring", service: KEYRING_SERVICE, account: key };
  }
  await writeProfilesFile({ ...file, license: token });
  return fileLocation(key);
}

export async function clearLicense(): Promise<boolean> {
  const removedFromKeyring = tryRemoveKeyring(account.license);
  const file = await readProfilesFile();
  const hadInline = file.license !== null;
  if (hadInline) {
    await writeProfilesFile({ ...file, license: null });
  }
  return removedFromKeyring === true || hadInline;
}
