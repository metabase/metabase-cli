import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";

import { Entry } from "@napi-rs/keyring";

import { parseJsonResult } from "../../runtime/json";
import { isNotFoundError, ValidationError } from "../errors";
import { configDir } from "../paths";
import type { ServerInfo } from "../version/probe";

import type { Credential, OAuthCredential } from "./credential";
import {
  ProfileLastFailure,
  ProfileLastProbe,
  ProfilesFile,
  type ProbedUser,
  type ProfileFailureKind,
  type ProfileOAuth,
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

export const KEYCHAIN_RESIDUAL_NOTICE =
  "warning: could not remove one or more secrets from the OS keychain; a stored token may remain — remove it manually or retry.";

export type ProfileApiKeyAccount = `profile:${string}:apiKey`;
export type ProfileOAuthAccessAccount = `profile:${string}:oauthAccess`;
export type ProfileOAuthRefreshAccount = `profile:${string}:oauthRefresh`;
export type CredentialAccount =
  | ProfileApiKeyAccount
  | ProfileOAuthAccessAccount
  | ProfileOAuthRefreshAccount;

export const account = {
  profileApiKey: (profile: string): ProfileApiKeyAccount => `profile:${profile}:apiKey`,
  profileOAuthAccess: (profile: string): ProfileOAuthAccessAccount =>
    `profile:${profile}:oauthAccess`,
  profileOAuthRefresh: (profile: string): ProfileOAuthRefreshAccount =>
    `profile:${profile}:oauthRefresh`,
} as const;

export interface KeyringLocation {
  backend: "keyring";
  service: string;
  account: CredentialAccount;
}

export type KeyringFallbackReason = "disabled" | "unavailable";

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

export interface ResolvedCredential {
  url: string;
  credential: Credential;
}

export interface ProbeWriteInput {
  user: ProbedUser;
  server: ServerInfo;
}

let legacyWarningPending = false;
let keychainResidualPending = false;
let keyringDowngradeNotice: string | null = null;

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

// Surfaced after a logout/credential switch when a keyring-backed secret could not be confirmed
// removed (e.g. the OS vault was locked), so the user knows a token may still be on disk in the
// keychain. Cleared on read, like the legacy-storage notice.
export function consumeKeychainResidualWarning(): string | null {
  if (!keychainResidualPending) {
    return null;
  }
  keychainResidualPending = false;
  return KEYCHAIN_RESIDUAL_NOTICE;
}

// Surfaced after an automatic token refresh had to fall back to the plaintext file because the OS
// keychain was unavailable, silently moving a previously keyring-backed credential onto disk. The
// command shell consumes it so the downgrade can't go unnoticed. Cleared on read.
export function consumeKeyringDowngradeWarning(): string | null {
  const message = keyringDowngradeNotice;
  keyringDowngradeNotice = null;
  return message;
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

// "skipped" — keyring disabled, nothing to do; "removed"/"absent" — delete succeeded (entry
// existed or not); "failed" — the backend threw, so we cannot confirm the secret is gone.
type KeyringRemoval = "skipped" | "removed" | "absent" | "failed";

function removeKeyringEntry(key: CredentialAccount): KeyringRemoval {
  if (!keyringEnabled()) {
    return "skipped";
  }
  try {
    return new Entry(KEYRING_SERVICE, key).deletePassword() ? "removed" : "absent";
  } catch {
    return "failed";
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
      return { profiles: [] };
    }
    throw error;
  }
  const parsed = parseJsonResult(raw, ProfilesFile, { source: path });
  if (parsed.ok) {
    return parsed.value;
  }
  if (parsed.error instanceof ValidationError) {
    legacyWarningPending = true;
    return { profiles: [] };
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
  if (file.profiles.length === 0) {
    await fs.unlink(path).catch(() => undefined);
    await cleanupLegacyFiles();
    return;
  }
  await fs.mkdir(dirname(path), { recursive: true, mode: PROFILES_DIR_MODE });
  // Write to a per-process temp file and atomically rename it into place. A crash or a concurrent
  // writer can then never leave a half-written profiles.json — which readProfilesFile would treat
  // as corrupt and discard, silently wiping every stored profile. (A concurrent writer may still
  // overwrite a just-rotated token, but the client's reactive 401-refresh recovers that.)
  const tmpPath = `${path}.${process.pid}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(file, null, 2) + "\n", { mode: PROFILES_FILE_MODE });
  if (process.platform !== "win32") {
    await fs.chmod(tmpPath, PROFILES_FILE_MODE);
  }
  try {
    await fs.rename(tmpPath, path);
  } catch (error) {
    // Don't leave a plaintext-token temp file behind if the rename fails.
    await fs.unlink(tmpPath).catch(() => undefined);
    throw error;
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

// Whether the given side's secret lives in the OS keyring (its inline copy is null) rather than in
// the file — the only case where a failed keyring delete can leave a residual secret behind.
function sideIsKeyringBacked(record: ProfileRecord, side: "apiKey" | "oauth"): boolean {
  return side === "oauth"
    ? record.oauth !== null && record.oauth.accessToken === null
    : record.oauth === null && record.apiKey === null;
}

// Flag a residual-secret warning only when a keyring delete failed for a side that was actually
// keyring-backed. Inline secrets are dropped with the record, so a failed delete there is harmless —
// warning on it would be a false positive on every login on a keyring-less host.
function flagResidualIfUnconfirmed(
  existing: ProfileRecord | null,
  cleared: "apiKey" | "oauth",
  removals: KeyringRemoval[],
): void {
  if (existing === null || !removals.includes("failed")) {
    return;
  }
  if (sideIsKeyringBacked(existing, cleared)) {
    keychainResidualPending = true;
  }
}

function fileLocation(key: CredentialAccount): FileLocation {
  return {
    backend: "file",
    path: profilesFilePath(),
    account: key,
    reason: keyringEnabled() ? "unavailable" : "disabled",
  };
}

export function keyringFallbackWarning(location: FileLocation): string {
  const cause =
    location.reason === "disabled"
      ? "OS keychain disabled via METABASE_CLI_DISABLE_KEYRING"
      : "OS keychain unavailable";
  return `warning: ${cause}; credentials stored as plaintext at ${location.path}`;
}

function persistSecret(key: CredentialAccount, value: string): CredentialLocation {
  if (trySetKeyring(key, value)) {
    return { backend: "keyring", service: KEYRING_SERVICE, account: key };
  }
  // Falling back to the plaintext file (keyring unavailable): drop any stale keyring entry so a
  // recovered vault can't later shadow the file copy with an out-of-date secret.
  removeKeyringEntry(key);
  return fileLocation(key);
}

function resolveSecret(key: CredentialAccount, inline: string | null): string | null {
  // The inline (file) copy is written only when the keyring write failed, so when it is present it
  // is authoritative — a stale keyring entry from a since-recovered vault must not shadow it.
  if (inline !== null) {
    return inline;
  }
  return tryReadKeyring(key) ?? null;
}

export async function readProfileCredential(
  name: string = DEFAULT_PROFILE,
): Promise<ResolvedCredential | null> {
  const file = await readProfilesFile();
  const record = findRecord(file, name);
  if (record === null) {
    return null;
  }
  return resolveRecordCredential(record);
}

export function resolveRecordCredential(record: ProfileRecord): ResolvedCredential | null {
  if (record.oauth !== null) {
    const accessToken = resolveSecret(
      account.profileOAuthAccess(record.name),
      record.oauth.accessToken,
    );
    const refreshToken = resolveSecret(
      account.profileOAuthRefresh(record.name),
      record.oauth.refreshToken,
    );
    if (accessToken === null || refreshToken === null) {
      return null;
    }
    return {
      url: record.url,
      credential: {
        kind: "oauth",
        accessToken,
        refreshToken,
        expiresAt: record.oauth.expiresAt,
        clientId: record.oauth.clientId,
      },
    };
  }
  const apiKey = resolveSecret(account.profileApiKey(record.name), record.apiKey);
  if (apiKey === null) {
    return null;
  }
  return { url: record.url, credential: { kind: "apiKey", apiKey } };
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

async function upsertRecord(
  file: ProfilesFile,
  name: string,
  updated: ProfileRecord,
): Promise<void> {
  const exists = findRecord(file, name) !== null;
  const profiles = exists
    ? file.profiles.map((entry) => (entry.name === name ? updated : entry))
    : [...file.profiles, updated];
  await writeProfilesFile({ ...file, profiles });
}

export async function writeProfile(
  profile: Profile,
  name: string = DEFAULT_PROFILE,
): Promise<CredentialLocation> {
  const location = persistSecret(account.profileApiKey(name), profile.apiKey);
  const inlineApiKey = location.backend === "file" ? profile.apiKey : null;

  const file = await readProfilesFile();
  const existing = findRecord(file, name);
  // Switching a profile to an API key clears any prior OAuth credential it held.
  flagResidualIfUnconfirmed(existing, "oauth", [
    removeKeyringEntry(account.profileOAuthAccess(name)),
    removeKeyringEntry(account.profileOAuthRefresh(name)),
  ]);
  const updated: ProfileRecord =
    existing === null
      ? {
          name,
          url: profile.url,
          apiKey: inlineApiKey,
          oauth: null,
          lastProbe: null,
          lastFailure: null,
        }
      : { ...existing, url: profile.url, apiKey: inlineApiKey, oauth: null };
  await upsertRecord(file, name, updated);
  return location;
}

export async function writeOAuthProfile(
  url: string,
  credential: OAuthCredential,
  name: string = DEFAULT_PROFILE,
): Promise<CredentialLocation> {
  const accessKey = account.profileOAuthAccess(name);
  const refreshKey = account.profileOAuthRefresh(name);
  const accessLocation = persistSecret(accessKey, credential.accessToken);
  const refreshLocation = persistSecret(refreshKey, credential.refreshToken);
  const onFile = accessLocation.backend === "file" || refreshLocation.backend === "file";

  const oauth: ProfileOAuth = {
    accessToken: onFile ? credential.accessToken : null,
    refreshToken: onFile ? credential.refreshToken : null,
    expiresAt: credential.expiresAt,
    clientId: credential.clientId,
  };
  const file = await readProfilesFile();
  const existing = findRecord(file, name);
  // A credential that was keyring-backed but now lands on file (keychain hiccup during refresh) is
  // a silent downgrade to plaintext — flag it so the command shell can warn.
  if (onFile && existing !== null && sideIsKeyringBacked(existing, "oauth")) {
    keyringDowngradeNotice = keyringFallbackWarning(fileLocation(accessKey));
  }
  // Switching a profile to OAuth clears any prior API key it held.
  flagResidualIfUnconfirmed(existing, "apiKey", [removeKeyringEntry(account.profileApiKey(name))]);
  const updated: ProfileRecord =
    existing === null
      ? { name, url, apiKey: null, oauth, lastProbe: null, lastFailure: null }
      : { ...existing, url, apiKey: null, oauth };
  await upsertRecord(file, name, updated);
  return onFile
    ? fileLocation(accessKey)
    : { backend: "keyring", service: KEYRING_SERVICE, account: accessKey };
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
  const file = await readProfilesFile();
  const existing = findRecord(file, name);
  const removals = [
    removeKeyringEntry(account.profileApiKey(name)),
    removeKeyringEntry(account.profileOAuthAccess(name)),
    removeKeyringEntry(account.profileOAuthRefresh(name)),
  ];
  if (existing !== null) {
    flagResidualIfUnconfirmed(existing, existing.oauth !== null ? "oauth" : "apiKey", removals);
  }
  if (existing === null) {
    return false;
  }
  await writeProfilesFile({
    ...file,
    profiles: file.profiles.filter((entry) => entry.name !== name),
  });
  return true;
}
