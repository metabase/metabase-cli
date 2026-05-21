#!/usr/bin/env node
import { runMain } from "citty";
import type { ArgsDef, CommandDef } from "citty";

import main from "./main";
import { resolveBreadcrumb, showUsage } from "./output/help";

async function showUsageWithBreadcrumb<T extends ArgsDef = ArgsDef>(
  cmd: CommandDef<T>,
  parent?: CommandDef<T>,
): Promise<void> {
  const breadcrumb = await resolveBreadcrumb(main, process.argv.slice(2));
  await showUsage(cmd, parent, breadcrumb);
}

runMain(main, { showUsage: showUsageWithBreadcrumb });
