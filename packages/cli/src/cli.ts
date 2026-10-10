#!/usr/bin/env node
import { parseArgs, runMain } from "citty";
import type { ArgsDef, CommandDef } from "citty";

import { ConfigError } from "@metabase/client/errors";

import { assertRequiredPositionals, separatePositionals } from "./commands/argv";
import { resolveOutputFormat } from "./commands/context";
import type { Format } from "./output/types";
import { hoistGlobalFlags } from "./commands/global-flags";
import { trustSystemCa } from "./core/system-ca";
import main from "./main";
import { reportError } from "./output/error";
import {
  findUnknownCommand,
  resolveBreadcrumb,
  resolveLeafArgv,
  showUsage,
  showUsageJson,
} from "./output/help";
import { installInterruptHandler } from "./runtime/interrupt";

const HELP_FLAGS: ReadonlySet<string> = new Set(["--help", "-h"]);
const JSON_HELP_FLAG = "--json";
const OUTPUT_FORMAT_FLAGS = ["json", "format"] as const;

async function run(): Promise<void> {
  installInterruptHandler((code) => process.exit(code));
  trustSystemCa();
  const rawArgs = await normalizeArgv(process.argv.slice(2));
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
    if (await refusedLeafArgv(rawArgs)) {
      return;
    }
  }
  await runMain(main, { showUsage: showUsageWithBreadcrumb, rawArgs });
}

async function refusedLeafArgv(rawArgs: readonly string[]): Promise<boolean> {
  const leaf = await resolveLeafArgv(main, rawArgs);
  if (leaf === null) {
    return false;
  }
  const leafArgs = rawArgs.slice(leaf.argsStart);
  try {
    assertRequiredPositionals(leafArgs, leaf.argsDef);
    return false;
  } catch (error) {
    reportError(error, reportFormat(leafArgs, leaf.argsDef));
    return true;
  }
}

// Parsed against the output flags alone: citty's parse of the whole definition throws on the very
// positional that is missing. A `--format` value the command would itself refuse leaves the argv
// error in plain text.
function reportFormat(leafArgs: readonly string[], argsDef: ArgsDef): Format | undefined {
  const outputFlags = Object.fromEntries(
    OUTPUT_FORMAT_FLAGS.flatMap((key) => {
      const def = argsDef[key];
      return def === undefined ? [] : [[key, def]];
    }),
  );
  const parsed = parseArgs([...leafArgs], outputFlags);
  const format = parsed["format"];
  const json = parsed["json"] === true;
  try {
    return resolveOutputFormat(typeof format === "string" ? { json, format } : { json });
  } catch {
    return undefined;
  }
}

async function normalizeArgv(argv: readonly string[]): Promise<string[]> {
  const hoisted = hoistGlobalFlags(argv);
  const leaf = await resolveLeafArgv(main, hoisted);
  if (leaf === null) {
    return hoisted;
  }
  const leafArgs = separatePositionals(hoisted.slice(leaf.argsStart), leaf.argsDef);
  return [...hoisted.slice(0, leaf.argsStart), ...leafArgs];
}

void run().catch((error: unknown) => {
  reportError(error);
});
