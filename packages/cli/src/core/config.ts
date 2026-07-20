import {
  type Credential,
  type CredentialRefresher,
  isOAuthExpired,
  type OAuthCredential,
} from "./auth/credential";
import { refreshOAuthCredential } from "./auth/oauth-session";
import {
  DEFAULT_PROFILE,
  readProfileCredential,
  readProfileRecord,
  writeOAuthProfile,
} from "./auth/storage";
import { ENV_API_KEY, ENV_PROFILE, ENV_SKIP_PREFLIGHT, ENV_URL, readEnv } from "./env";
import { ConfigError } from "./errors";
import { normalizeUrl } from "./url";

export const SKIP_PREFLIGHT_ENV = ENV_SKIP_PREFLIGHT;

export function isPreflightSkipped(): boolean {
  return readEnv(ENV_SKIP_PREFLIGHT) === "1";
}

export type ConfigSource = "flag" | "env" | "stored" | "mixed";

export interface ConfigFlags {
  profile?: string;
  url?: string;
  apiKey?: string;
}

export interface ResolvedConfig {
  url: string;
  credential: Credential;
  profile: string;
  source: ConfigSource;
}

export interface EnvCredentials {
  url: string | null;
  apiKey: string | null;
}

interface UrlResolution {
  value: string;
  source: "flag" | "env" | "stored";
}

interface CredentialResolution {
  credential: Credential;
  source: "flag" | "env" | "stored";
}

export function resolveProfileName(profileFlag: string | undefined): string {
  return explicitProfileName(profileFlag) ?? DEFAULT_PROFILE;
}

export function explicitProfileName(profileFlag: string | undefined): string | null {
  return profileFlag || readEnv(ENV_PROFILE) || null;
}

export function readEnvCredentials(): EnvCredentials {
  return {
    url: readEnv(ENV_URL) ?? null,
    apiKey: readEnv(ENV_API_KEY) ?? null,
  };
}

export async function resolveConfig(flags: ConfigFlags): Promise<ResolvedConfig> {
  const profile = resolveProfileName(flags.profile);
  const env = readEnvCredentials();
  const hasUrl = Boolean(flags.url ?? env.url);
  const hasKey = Boolean(flags.apiKey ?? env.apiKey);

  const stored = hasUrl && hasKey ? null : await readProfileCredential(profile);

  const url = resolveUrl(flags.url, env.url, stored?.url);
  const credential = resolveCredential(flags.apiKey, env.apiKey, stored?.credential);

  if (url === null || credential === null) {
    const hint = await failureHintForProfile(profile);
    throw new ConfigError(
      `Not authenticated for profile "${profile}". Run \`mb auth login\`, set ${ENV_URL}/${ENV_API_KEY}, or pass --url/--api-key.${hint}`,
    );
  }

  const normalizedUrl = normalizeUrl(url.value);
  // OAuth credentials are always loaded from a stored profile, so stored?.url is the issuer the
  // refresh token is bound to — refresh against that, never a (possibly --url-overridden) request URL.
  assertOAuthUrlMatchesIssuer(credential.credential, stored?.url, normalizedUrl, profile);
  const fresh = await ensureFreshCredential(profile, credential.credential, stored?.url);

  return {
    url: normalizedUrl,
    credential: fresh,
    profile,
    source: url.source === credential.source ? url.source : "mixed",
  };
}

// A stored OAuth credential's bearer/refresh tokens are bound to the issuer that minted them.
// Refuse to send them to a different host named by --url/MB_URL: that would leak the bearer
// token to the foreign host, and the 401-refresh loop would keep minting fresh tokens for it too.
// API-key credentials are unaffected (and only OAuth credentials ever come from a stored profile).
function assertOAuthUrlMatchesIssuer(
  credential: Credential,
  issuerUrl: string | undefined,
  requestUrl: string,
  profile: string,
): void {
  if (credential.kind !== "oauth" || issuerUrl === undefined) {
    return;
  }
  const issuer = normalizeUrl(issuerUrl);
  if (issuer === requestUrl) {
    return;
  }
  throw new ConfigError(
    `profile "${profile}" is a browser-login (OAuth) profile bound to ${issuer}, but the request URL is ${requestUrl}. ` +
      `Drop --url/${ENV_URL} to use the profile's own URL, or run \`mb auth login --url ${requestUrl}\` to authenticate there.`,
  );
}

// Proactively refresh a stored OAuth credential that has reached its expiry, persisting the rotated
// tokens so the next invocation starts fresh. API-key credentials pass through untouched.
async function ensureFreshCredential(
  profile: string,
  credential: Credential,
  issuerUrl: string | undefined,
): Promise<Credential> {
  if (credential.kind !== "oauth" || issuerUrl === undefined) {
    return credential;
  }
  if (!isOAuthExpired(credential, Date.now())) {
    return credential;
  }
  let refreshed: OAuthCredential;
  try {
    refreshed = await refreshOAuthCredential(issuerUrl, credential, Date.now());
  } catch {
    // Best-effort: a failed network refresh (server blip, offline) falls back to the existing
    // credential and lets the reactive 401-refresh retry, rather than failing every command.
    return credential;
  }
  // The rotated refresh token now in hand is the only valid copy — the server has consumed the old
  // one. A persist failure must surface, not be swallowed: silently returning the old credential
  // would leave the consumed token stored and brick the grant on the next refresh.
  await persistRefreshed(profile, issuerUrl, refreshed);
  return refreshed;
}

async function refreshAndPersist(
  profile: string,
  issuerUrl: string,
  credential: OAuthCredential,
): Promise<OAuthCredential> {
  const refreshed = await refreshOAuthCredential(issuerUrl, credential, Date.now());
  await persistRefreshed(profile, issuerUrl, refreshed);
  return refreshed;
}

// Persist rotated tokens. writeOAuthProfile flags a pending warning when the keychain was
// unavailable and the tokens had to land in the plaintext file — the command shell surfaces it so
// a background refresh can't silently downgrade keyring-backed credentials to disk.
async function persistRefreshed(
  profile: string,
  issuerUrl: string,
  refreshed: OAuthCredential,
): Promise<void> {
  await writeOAuthProfile(issuerUrl, refreshed, profile);
}

// Reactive refresher handed to the HTTP client: on a 401 it reloads the stored OAuth credential
// (picking up any rotated refresh token), refreshes against the credential's own issuer URL,
// persists, and returns the new credential. A refresh the server rejects (revoked/expired grant)
// is terminal for this credential, so the error tells the user how to recover.
export function createCredentialRefresher(profile: string): CredentialRefresher {
  return async () => {
    const stored = await readProfileCredential(profile);
    if (stored === null || stored.credential.kind !== "oauth") {
      return null;
    }
    try {
      return await refreshAndPersist(profile, stored.url, stored.credential);
    } catch (error) {
      if (error instanceof ConfigError) {
        throw new ConfigError(
          `${error.message} — run \`mb auth login --profile ${profile}\` to log in again`,
        );
      }
      throw error;
    }
  };
}

async function failureHintForProfile(profile: string): Promise<string> {
  const record = await readProfileRecord(profile);
  if (record === null || record.lastFailure === null) {
    return "";
  }
  if (record.lastProbe !== null && record.lastProbe.at >= record.lastFailure.at) {
    return "";
  }
  return ` profile "${profile}" last verify failed: ${record.lastFailure.reason}. Run \`mb auth login --profile ${profile}\` to update the token.`;
}

function resolveUrl(
  flag: string | undefined,
  env: string | null,
  stored: string | undefined,
): UrlResolution | null {
  if (flag) {
    return { value: flag, source: "flag" };
  }
  if (env) {
    return { value: env, source: "env" };
  }
  if (stored) {
    return { value: stored, source: "stored" };
  }
  return null;
}

function resolveCredential(
  flagKey: string | undefined,
  envKey: string | null,
  stored: Credential | undefined,
): CredentialResolution | null {
  if (flagKey) {
    return { credential: { kind: "apiKey", apiKey: flagKey }, source: "flag" };
  }
  if (envKey) {
    return { credential: { kind: "apiKey", apiKey: envKey }, source: "env" };
  }
  if (stored) {
    return { credential: stored, source: "stored" };
  }
  return null;
}
