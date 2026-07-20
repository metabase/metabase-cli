import { ConfigError } from "../core/errors";

export interface NamedFlag {
  readonly name: string;
  readonly value: string | undefined;
}

export interface FlagPair {
  readonly first: string;
  readonly second: string;
}

export function requireBothOrNeither(first: NamedFlag, second: NamedFlag): FlagPair | null {
  const firstSet = first.value !== undefined && first.value !== "";
  const secondSet = second.value !== undefined && second.value !== "";
  if (!firstSet && !secondSet) {
    return null;
  }
  if (!firstSet) {
    throw new ConfigError(`${first.name} is required when using ${second.name}`);
  }
  if (!secondSet) {
    throw new ConfigError(`${second.name} is required when using ${first.name}`);
  }
  return { first: first.value, second: second.value };
}
