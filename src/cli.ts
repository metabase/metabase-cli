#!/usr/bin/env node
import { runMain } from "citty";
import type { ArgsDef, CommandDef } from "citty";

import { ConfigError } from "./core/errors";
import main from "./main";
import { reportError } from "./output/error";
import { findUnknownCommand, resolveBreadcrumb, showUsage } from "./output/help";

const HELP_FLAGS: ReadonlySet<string> = new Set(["--help", "-h"]);

async function showUsageWithBreadcrumb<T extends ArgsDef = ArgsDef>(
  cmd: CommandDef<T>,
  parent?: CommandDef<T>,
): Promise<void> {
  const breadcrumb = await resolveBreadcrumb(main, process.argv.slice(2));
  await showUsage(cmd, parent, breadcrumb);
}

async function run(): Promise<void> {
  const rawArgs = process.argv.slice(2);
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
