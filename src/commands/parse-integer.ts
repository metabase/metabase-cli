import { ConfigError } from "../core/errors";

const INTEGER_PATTERN = /^-?\d+$/;

export interface ParseIntegerOptions {
  name: string;
  min: number;
}

export function parseInteger(value: string, options: ParseIntegerOptions): number {
  const trimmed = value.trim();
  if (!INTEGER_PATTERN.test(trimmed)) {
    throw new ConfigError(`invalid ${options.name}: "${value}" (expected integer)`);
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (parsed < options.min) {
    throw new ConfigError(`invalid ${options.name}: ${parsed} (must be ≥ ${options.min})`);
  }
  return parsed;
}

export function parseOptionalInteger(
  value: string | undefined,
  options: ParseIntegerOptions,
): number | null {
  if (value === undefined || value === "") {
    return null;
  }
  return parseInteger(value, options);
}
