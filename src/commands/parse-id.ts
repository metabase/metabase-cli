import { ConfigError } from "../core/errors";

const INTEGER_PATTERN = /^-?\d+$/;

export function parseId(value: string, name = "id"): number {
  const trimmed = value.trim();
  if (!INTEGER_PATTERN.test(trimmed)) {
    throw new ConfigError(`invalid ${name}: "${value}" (expected integer)`);
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (parsed < 1) {
    throw new ConfigError(`invalid ${name}: ${parsed} (must be a positive integer)`);
  }
  return parsed;
}
