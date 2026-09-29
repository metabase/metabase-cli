import { ConfigError } from "@metabase/client/errors";

import { givenValue } from "../runtime/input";

interface NamedFlag {
  readonly name: string;
  readonly value: string | undefined;
}

interface FlagPair {
  readonly first: string;
  readonly second: string;
}

export function requireBothOrNeither(first: NamedFlag, second: NamedFlag): FlagPair | null {
  const firstValue = givenValue(first.value);
  const secondValue = givenValue(second.value);
  if (firstValue === null && secondValue === null) {
    return null;
  }
  if (firstValue === null) {
    throw new ConfigError(`${first.name} is required when using ${second.name}`);
  }
  if (secondValue === null) {
    throw new ConfigError(`${second.name} is required when using ${first.name}`);
  }
  return { first: firstValue, second: secondValue };
}
