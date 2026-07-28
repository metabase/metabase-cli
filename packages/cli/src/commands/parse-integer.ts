import { ConfigError } from "@metabase/client/errors";

const INTEGER_PATTERN = /^-?\d+$/;

interface ParseIntegerOptions {
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

// Only an absent flag is unset. An empty string is what a shell hands over for an expansion that
// resolved to nothing (`--limit "$N"`), and reading it as "no bound" turns a typo into a full
// unfiltered listing, so it fails like any other non-integer.
export function parseOptionalInteger(
  value: string | undefined,
  options: ParseIntegerOptions,
): number | null {
  if (value === undefined) {
    return null;
  }
  return parseInteger(value, options);
}
