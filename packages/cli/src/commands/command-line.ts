import type { CommandDef } from "citty";

import { ConfigError } from "@metabase/client/errors";

import { findUnknownCommand, resolveLeafArgv } from "../output/help";
import { isFlagToken } from "../runtime/citty";
import { assertArgv, assertRequiredPositionals, separatePositionals } from "./argv";
import { hoistGlobalFlags } from "./global-flags";

export const HELP_FLAGS: ReadonlySet<string> = new Set(["--help", "-h"]);
// The flags a group answers itself, since it runs nothing.
const GROUP_FLAGS: ReadonlySet<string> = new Set([...HELP_FLAGS, "--version", "-v", "--json"]);

export async function normalizeArgv(root: CommandDef, argv: readonly string[]): Promise<string[]> {
  const hoisted = hoistGlobalFlags(argv);
  const leaf = await resolveLeafArgv(root, hoisted);
  if (leaf === null) {
    return hoisted;
  }
  const leafArgs = separatePositionals(hoisted.slice(leaf.argsStart), leaf.argsDef);
  return [...hoisted.slice(0, leaf.argsStart), ...leafArgs];
}

/**
 * Refuses a command line as the CLI refuses it before the command runs, and runs nothing. What a
 * command checks for itself, such as a flag's value, is not checked.
 */
export async function assertCommandLine(root: CommandDef, argv: readonly string[]): Promise<void> {
  const rawArgs = await normalizeArgv(root, argv);
  const unknown = await findUnknownCommand(root, rawArgs);
  if (unknown !== null) {
    throw new ConfigError(`unknown command: ${unknown}`);
  }
  const leaf = await resolveLeafArgv(root, rawArgs);
  if (leaf === null) {
    assertGroupFlags(rawArgs);
    return;
  }
  const leafArgs = rawArgs.slice(leaf.argsStart);
  if (!leafArgs.some((arg) => HELP_FLAGS.has(arg))) {
    assertRequiredPositionals(leafArgs, leaf.argsDef);
  }
  assertArgv(leafArgs, leaf.argsDef);
}

function assertGroupFlags(rawArgs: readonly string[]): void {
  const flag = rawArgs.find((arg) => isFlagToken(arg) && !GROUP_FLAGS.has(arg));
  if (flag !== undefined) {
    throw new ConfigError(`${flag} follows a command group; name one of the group's commands`);
  }
}
