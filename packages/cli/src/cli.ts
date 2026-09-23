#!/usr/bin/env node
import { runMain } from "citty";
import type { ArgsDef, CommandDef } from "citty";

import { ConfigError } from "@metabase/client/errors";

import { hoistGlobalFlags } from "./commands/global-flags";
import { trustSystemCa } from "./core/system-ca";
import main from "./main";
import { reportError } from "./output/error";
import { findUnknownCommand, resolveBreadcrumb, showUsage, showUsageJson } from "./output/help";
import { installInterruptHandler } from "./runtime/interrupt";

const HELP_FLAGS: ReadonlySet<string> = new Set(["--help", "-h"]);
const JSON_HELP_FLAG = "--json";
// Commands a published Metabase CLI has and this one never will: the credential is the
// environment's.
const CREDENTIAL_COMMANDS: ReadonlySet<string> = new Set(["auth", "login", "logout", "profile"]);
const CREDENTIAL_HINT =
  "the credential comes from the environment the app sets, so there is no sign-in command";
const COMMANDS_HINT = "run `mb --help` for the commands";

function unknownCommandMessage(unknown: string): string {
  const hint = CREDENTIAL_COMMANDS.has(unknown) ? CREDENTIAL_HINT : COMMANDS_HINT;
  return `unknown command: ${unknown}; ${hint}`;
}

async function run(): Promise<void> {
  installInterruptHandler((code) => process.exit(code));
  trustSystemCa();
  const rawArgs = hoistGlobalFlags(process.argv.slice(2));
  const wantsJsonHelp = rawArgs.includes(JSON_HELP_FLAG);

  const showUsageWithBreadcrumb = async <T extends ArgsDef = ArgsDef>(
    cmd: CommandDef<T>,
    parent?: CommandDef<T>,
  ): Promise<void> => {
    const breadcrumb = await resolveBreadcrumb(main, rawArgs);
    if (wantsJsonHelp) {
      await showUsageJson(cmd, breadcrumb);
      return;
    }
    await showUsage(cmd, parent, breadcrumb);
  };

  if (rawArgs.length === 0) {
    await showUsageWithBreadcrumb(main);
    return;
  }
  if (!rawArgs.some((arg) => HELP_FLAGS.has(arg))) {
    const unknown = await findUnknownCommand(main, rawArgs);
    if (unknown !== null) {
      reportError(new ConfigError(unknownCommandMessage(unknown)));
      return;
    }
  }
  await runMain(main, { showUsage: showUsageWithBreadcrumb, rawArgs });
}

void run().catch((error: unknown) => {
  reportError(error);
});
