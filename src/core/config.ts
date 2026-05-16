import { readRejection } from "./auth/rejection";
import { DEFAULT_PROFILE, readLicense, readProfile } from "./auth/storage";
import { ConfigError } from "./errors";
import { normalizeUrl, originOnly } from "./url";

const ENV_URL = "METABASE_URL";
const ENV_API_KEY = "METABASE_API_KEY";
const ENV_PROFILE = "METABASE_PROFILE";
const ENV_LICENSE_TOKEN = "METABASE_LICENSE_TOKEN";
const ENV_SKIP_PREFLIGHT = "METABASE_CLI_SKIP_PREFLIGHT";

export const SKIP_PREFLIGHT_ENV = ENV_SKIP_PREFLIGHT;

export function isPreflightSkipped(): boolean {
  return process.env[ENV_SKIP_PREFLIGHT] === "1";
}

export type ConfigSource = "flag" | "env" | "stored" | "mixed";

export interface ConfigFlags {
  profile?: string;
  url?: string;
  apiKey?: string;
}

export interface ResolvedConfig {
  url: string;
  apiKey: string;
  profile: string;
  source: ConfigSource;
}

export interface LicenseFlags {
  token?: string;
}

export interface EnvCredentials {
  url: string | null;
  apiKey: string | null;
}

interface FieldResolution {
  value: string;
  source: "flag" | "env" | "stored";
}

export function resolveProfileName(profileFlag: string | undefined): string {
  return explicitProfileName(profileFlag) ?? DEFAULT_PROFILE;
}

export function explicitProfileName(profileFlag: string | undefined): string | null {
  return profileFlag || process.env[ENV_PROFILE] || null;
}

export function readEnvCredentials(): EnvCredentials {
  return {
    url: process.env[ENV_URL] ?? null,
    apiKey: process.env[ENV_API_KEY] ?? null,
  };
}

export function readEnvLicenseToken(): string | null {
  return process.env[ENV_LICENSE_TOKEN] ?? null;
}

export async function resolveConfig(flags: ConfigFlags): Promise<ResolvedConfig> {
  const profile = resolveProfileName(flags.profile);
  const env = readEnvCredentials();
  const flagUrl = flags.url;
  const flagKey = flags.apiKey;

  const needsStored = (!flagUrl && !env.url) || (!flagKey && !env.apiKey);
  const stored = needsStored ? await readProfile(profile) : null;

  const urlField = pickField(flagUrl, env.url, stored?.url);
  const keyField = pickField(flagKey, env.apiKey, stored?.apiKey);

  if (urlField === null || keyField === null) {
    const rejection = await readRejection(profile);
    if (rejection !== null) {
      throw new ConfigError(
        `Last login for profile "${profile}" was rejected by ${originOnly(rejection.url)}: ${rejection.reason}. Re-run \`mb auth login --profile ${profile}\` with valid credentials.`,
      );
    }
    throw new ConfigError(
      `Not authenticated for profile "${profile}". Run \`mb auth login\`, set ${ENV_URL}/${ENV_API_KEY}, or pass --url/--api-key.`,
    );
  }

  return {
    url: normalizeUrl(urlField.value),
    apiKey: keyField.value,
    profile,
    source: urlField.source === keyField.source ? urlField.source : "mixed",
  };
}

export async function resolveLicenseToken(flags: LicenseFlags): Promise<string> {
  const flag = flags.token;
  const env = readEnvLicenseToken();
  const stored = !flag && !env ? await readLicense() : null;
  const value = flag ?? env ?? stored;
  if (!value) {
    throw new ConfigError(
      `No license token. Pass --token, set ${ENV_LICENSE_TOKEN}, or store one with \`mb license set\`.`,
    );
  }
  return value;
}

function pickField(
  flag: string | null | undefined,
  env: string | null | undefined,
  stored: string | null | undefined,
): FieldResolution | null {
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
