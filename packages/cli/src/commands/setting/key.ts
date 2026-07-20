import { ConfigError, errorMessage } from "../../core/errors";

const SETTING_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;
const UNKNOWN_SETTING_PREFIX = "Unknown setting:";

export function parseSettingKey(value: string): string {
  const trimmed = value.trim();
  if (!SETTING_KEY_PATTERN.test(trimmed)) {
    throw new ConfigError(`invalid setting key: "${value}" (expected kebab-case identifier)`);
  }
  return trimmed;
}

// Metabase echoes an unknown setting back as a Clojure keyword (":foo"); surface the user's
// key instead of leaking the leading colon, and treat it as an input error (exit 2).
export function rethrowSettingError(error: unknown, key: string): never {
  if (errorMessage(error).startsWith(UNKNOWN_SETTING_PREFIX)) {
    throw new ConfigError(`unknown setting: ${key}`);
  }
  throw error;
}
