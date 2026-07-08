#!/usr/bin/env node
import { runMain } from "citty";
import type { ArgsDef, CommandDef } from "citty";

import { hoistGlobalFlags } from "./commands/global-flags";
import { ConfigError } from "./core/errors";
import main from "./main";
import { reportError } from "./output/error";
import { findUnknownCommand, resolveBreadcrumb, showUsage, showUsageJson } from "./output/help";

const HELP_FLAGS: ReadonlySet<string> = new Set(["--help", "-h"]);
const JSON_HELP_FLAG = "--json";

async function run(): Promise<void> {
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
      reportError(new ConfigError(`unknown command: ${unknown}`));
      return;
    }
  }
  await runMain(main, { showUsage: showUsageWithBreadcrumb, rawArgs });
}

void run().catch((error: unknown) => {
  reportError(error);
});
