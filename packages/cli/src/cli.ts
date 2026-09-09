#!/usr/bin/env node
import { runMain } from "citty";
import type { ArgsDef, CommandDef } from "citty";

import { ConfigError } from "@metabase/client/errors";

import { hoistGlobalFlags } from "./commands/global-flags";
import { trustSystemCa } from "./core/system-ca";
import main from "./main";
import { reportError } from "./output/error";
import { resolveInvocation, showUsage, showUsageJson } from "./output/help";
import { installInterruptHandler } from "./runtime/interrupt";
import { setVerbChain } from "./runtime/verb-chain";

const HELP_FLAGS: ReadonlySet<string> = new Set(["--help", "-h"]);
const JSON_HELP_FLAG = "--json";

async function run(): Promise<void> {
  installInterruptHandler((code) => process.exit(code));
  trustSystemCa();
  const rawArgs = hoistGlobalFlags(process.argv.slice(2));
  const wantsJsonHelp = rawArgs.includes(JSON_HELP_FLAG);

  const showUsageWithBreadcrumb = async <T extends ArgsDef = ArgsDef>(
    cmd: CommandDef<T>,
    parent?: CommandDef<T>,
  ): Promise<void> => {
    const { breadcrumb } = await resolveInvocation(main, rawArgs);
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
    const { unknownToken, verbs } = await resolveInvocation(main, rawArgs);
    if (unknownToken !== null) {
      reportError(new ConfigError(`unknown command: ${unknownToken}`));
      return;
    }
    setVerbChain(verbs);
  }
  await runMain(main, { showUsage: showUsageWithBreadcrumb, rawArgs });
}

void run().catch((error: unknown) => {
  reportError(error);
});
