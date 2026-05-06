import { ConfigError } from "../../core/errors";

const SETTING_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;

export function parseSettingKey(value: string): string {
  const trimmed = value.trim();
  if (!SETTING_KEY_PATTERN.test(trimmed)) {
    throw new ConfigError(`invalid setting key: "${value}" (expected kebab-case identifier)`);
  }
  return trimmed;
}
