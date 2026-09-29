import type { ArgsDef } from "citty";

import { flagSpellings, readArgv } from "../runtime/citty";

import { connectionFlags, listFlags, outputFlags, profileFlag } from "./flags";

const GLOBAL_FLAG_ARGS: ArgsDef = {
  ...outputFlags,
  ...listFlags,
  ...profileFlag,
  ...connectionFlags,
};

const GLOBAL_FLAG_SPELLINGS = flagSpellings(GLOBAL_FLAG_ARGS);

// `--profile`/`--url`/`--apiKey` (and the other common flags) are per-leaf citty args, not
// true globals. Placed before the verb chain, citty consumes the flag VALUE as a subcommand
// name and fails with a misleading "unknown command <value>". Hoisting the leading run of
// recognized global flags to the tail — after the verb chain — lets them parse at the resolved
// leaf, so `mb --profile staging card list` behaves like `mb card list --profile staging`.
export function hoistGlobalFlags(rawArgs: readonly string[]): string[] {
  const end = leadingGlobalFlagsEnd(rawArgs);
  if (end === 0) {
    return [...rawArgs];
  }
  return [...rawArgs.slice(end), ...rawArgs.slice(0, end)];
}

function leadingGlobalFlagsEnd(rawArgs: readonly string[]): number {
  let end = 0;
  for (const item of readArgv(rawArgs, GLOBAL_FLAG_SPELLINGS)) {
    if (item.kind !== "flag" || item.flag === null) {
      return end;
    }
    end = item.end;
  }
  return end;
}
