const CANONICAL_PREFIX = "MB_";
const LEGACY_PREFIX = "METABASE_";

export const ENV_URL = "MB_URL";
export const ENV_API_KEY = "MB_API_KEY";
export const ENV_PROFILE = "MB_PROFILE";
export const ENV_VERBOSE = "MB_VERBOSE";
export const ENV_SKIP_PREFLIGHT = "MB_CLI_SKIP_PREFLIGHT";
export const ENV_DISABLE_KEYRING = "MB_CLI_DISABLE_KEYRING";

function legacyNameFor(canonical: string): string {
  return LEGACY_PREFIX + canonical.slice(CANONICAL_PREFIX.length);
}

const legacyVarsUsed = new Set<string>();

// Read a CLI environment variable by its canonical `MB_` name, falling back to the deprecated
// `METABASE_` alias. A read served from the legacy alias is recorded so the command shell can warn
// the user once per invocation (see `consumeLegacyEnvWarnings`).
export function readEnv(canonical: string): string | undefined {
  const direct = process.env[canonical];
  if (direct !== undefined) {
    return direct;
  }
  const legacyValue = process.env[legacyNameFor(canonical)];
  if (legacyValue !== undefined) {
    legacyVarsUsed.add(canonical);
    return legacyValue;
  }
  return undefined;
}

export function consumeLegacyEnvWarnings(): string[] {
  if (legacyVarsUsed.size === 0) {
    return [];
  }
  const messages = [...legacyVarsUsed].map(legacyEnvWarning);
  legacyVarsUsed.clear();
  return messages;
}

function legacyEnvWarning(canonical: string): string {
  return `warning: ${legacyNameFor(canonical)} is deprecated; set ${canonical} instead`;
}
