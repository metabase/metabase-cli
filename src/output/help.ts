import { renderUsage } from "citty";
import type { ArgsDef, CommandDef, SubCommandsDef } from "citty";

import { resolveCitty, toAliasArray } from "../runtime/citty";
import { getMetabaseAugment } from "../runtime/command-augment";

export const ANSI_ESC = String.fromCharCode(27);
const ANSI_PATTERN = new RegExp(`${ANSI_ESC}\\[[0-9;]*m`, "g");

// Citty appends "<description> (<command name> [vX])" as the first line; the parenthetical
// duplicates the breadcrumb the user already typed to reach this --help.
const BREADCRUMB_SUFFIX = / \([^()]*\)\s*$/;
const TRAILING_WHITESPACE = /[ \t]+$/;

// Citty renders multi-character flag aliases with a single leading dash (`-max-bytes`), a
// form node's parser does not accept. Collapse a `-foo-bar, --fooBar` pair to the single
// working `--foo-bar` form, re-padding so the right-aligned column keeps its width.
const ALIAS_PAIR = /-([a-z0-9]+(?:-[a-z0-9]+)+), --[A-Za-z0-9]+/g;

const USAGE_PREFIX = "USAGE ";
const OPTIONS_HEADER = "OPTIONS";
const LINE_PREFIX = "  ";
const COLUMN_GAP = "  ";
const COMMAND_PLACEHOLDER = "<command> [options]";

const MANIFEST_COMMAND = "__manifest";
const CLI_NAME = "mb";

const HELP_FLAG_SPEC = "-h, --help";
const HELP_FLAG_DESCRIPTION = "Show help for this command";

const GETTING_STARTED_HINT = `First time? Run \`${CLI_NAME} auth login\` to connect to a Metabase instance.`;

interface UsageRewrite {
  cittyName: string;
  breadcrumb: string;
  hasSubCommands: boolean;
}

export async function showUsage<T extends ArgsDef = ArgsDef>(
  cmd: CommandDef<T>,
  parent?: CommandDef<T>,
  breadcrumb?: string,
): Promise<void> {
  const raw = (await renderUsage(cmd, parent)).replace(ANSI_PATTERN, "");
  const lines = raw.split("\n").map((line) => line.replace(TRAILING_WHITESPACE, ""));

  const cmdMeta = await resolveCitty(cmd.meta);
  const parentMeta = parent === undefined ? undefined : await resolveCitty(parent.meta);
  const cmdName = cmdMeta?.name ?? "";
  const cittyName = parentMeta?.name ? `${parentMeta.name} ${cmdName}` : cmdName;
  const hasSubCommands = Boolean(cmd.subCommands);
  const isRoot = parent === undefined && hasSubCommands;
  const isManifest = cmdName === MANIFEST_COMMAND;

  const augment = getMetabaseAugment(cmd);
  const details = augment?.details ?? null;
  const examples = augment?.examples ?? [];

  const transformed = transformBody(lines, {
    cittyName,
    breadcrumb: breadcrumb ?? cittyName,
    hasSubCommands,
  });
  const body = withDetails(transformed, details).join("\n").trimEnd();

  const sections = [body];
  if (examples.length > 0) {
    sections.push(renderExamples(examples));
  }
  if (isRoot) {
    sections.push(GETTING_STARTED_HINT);
  }
  if (!isManifest) {
    sections.push(renderSchemaHint());
  }
  process.stdout.write(sections.join("\n\n") + "\n");
}

function transformBody(lines: string[], rewrite: UsageRewrite): string[] {
  const mapped = lines.map((line, index) => {
    if (index === 0) {
      return line.replace(BREADCRUMB_SUFFIX, "");
    }
    if (line.startsWith(USAGE_PREFIX)) {
      return rewriteUsageLine(line, rewrite);
    }
    return fixAliasRow(line);
  });
  return injectHelpOption(mapped);
}

function rewriteUsageLine(line: string, rewrite: UsageRewrite): string {
  if (rewrite.hasSubCommands) {
    return `${USAGE_PREFIX}${rewrite.breadcrumb} ${COMMAND_PLACEHOLDER}`;
  }
  const content = line.slice(USAGE_PREFIX.length);
  if (!content.startsWith(rewrite.cittyName)) {
    return line;
  }
  const rest = content.slice(rewrite.cittyName.length);
  return `${USAGE_PREFIX}${rewrite.breadcrumb}${rest}`;
}

function fixAliasRow(line: string): string {
  return line.replace(ALIAS_PAIR, (match: string, kebab: string) =>
    `--${kebab}`.padStart(match.length),
  );
}

function injectHelpOption(lines: string[]): string[] {
  const headerIndex = lines.indexOf(OPTIONS_HEADER);
  if (headerIndex < 0) {
    return lines;
  }
  let firstRowIndex = headerIndex + 1;
  while (firstRowIndex < lines.length && lines[firstRowIndex] === "") {
    firstRowIndex += 1;
  }
  const sample = lines[firstRowIndex];
  if (sample === undefined) {
    return lines;
  }
  const layout = optionLayout(sample);
  if (layout === null) {
    return lines;
  }
  let endIndex = firstRowIndex;
  while (endIndex < lines.length && lines[endIndex] !== "") {
    endIndex += 1;
  }
  const helpRow =
    HELP_FLAG_SPEC.padStart(layout.flagEnd).padEnd(layout.descStart) + HELP_FLAG_DESCRIPTION;
  return [...lines.slice(0, endIndex), helpRow, ...lines.slice(endIndex)];
}

interface OptionLayout {
  flagEnd: number;
  descStart: number;
}

function optionLayout(row: string): OptionLayout | null {
  const firstNonSpace = row.search(/\S/);
  if (firstNonSpace < 0) {
    return null;
  }
  const flagEnd = row.indexOf(COLUMN_GAP, firstNonSpace);
  if (flagEnd < 0) {
    return null;
  }
  const gapRemainder = row.slice(flagEnd).search(/\S/);
  if (gapRemainder < 0) {
    return null;
  }
  return { flagEnd, descStart: flagEnd + gapRemainder };
}

function withDetails(lines: string[], details: string | null): string[] {
  if (details === null) {
    return lines;
  }
  const [first, ...rest] = lines;
  if (first === undefined) {
    return lines;
  }
  return [first, "", details, ...rest];
}

function renderExamples(examples: readonly string[]): string {
  return ["EXAMPLES", "", ...examples.map((example) => `${LINE_PREFIX}${example}`)].join("\n");
}

function renderSchemaHint(): string {
  return [
    "SCHEMA",
    "",
    `${LINE_PREFIX}${CLI_NAME} ${MANIFEST_COMMAND}      # machine-readable command manifest (flags, output, examples)`,
  ].join("\n");
}

interface SubCommandMatch {
  name: string;
  command: CommandDef;
}

// Citty's renderUsage only knows a command's immediate parent, so the leaf USAGE line drops
// the ancestry above it. Citty's own path walk (resolveSubCommand/findSubCommandIndex) is not
// exported, so we re-walk the tree from the root against rawArgs to recover the full breadcrumb.
export async function resolveBreadcrumb(
  root: CommandDef,
  rawArgs: readonly string[],
): Promise<string> {
  const rootMeta = await resolveCitty(root.meta);
  const segments: string[] = rootMeta?.name === undefined ? [] : [rootMeta.name];
  let current: CommandDef = root;
  let index = 0;
  while (index < rawArgs.length) {
    const subCommands = await resolveCitty(current.subCommands);
    if (subCommands === undefined) {
      break;
    }
    const argsDef = (await resolveCitty(current.args)) ?? {};
    index = skipFlags(rawArgs, index, argsDef);
    const token = rawArgs[index];
    if (token === undefined) {
      break;
    }
    const match = await findSubCommand(subCommands, token);
    if (match === null) {
      break;
    }
    segments.push(match.name);
    current = match.command;
    index += 1;
  }
  return segments.length > 0 ? segments.join(" ") : CLI_NAME;
}

function skipFlags(rawArgs: readonly string[], start: number, argsDef: ArgsDef): number {
  let index = start;
  while (index < rawArgs.length) {
    const token = rawArgs[index];
    if (token === undefined) {
      return index;
    }
    if (token === "--") {
      return rawArgs.length;
    }
    if (!token.startsWith("-")) {
      return index;
    }
    if (!token.includes("=") && consumesValue(token, argsDef)) {
      index += 1;
    }
    index += 1;
  }
  return index;
}

function consumesValue(token: string, argsDef: ArgsDef): boolean {
  const name = normalizeFlag(token);
  for (const [key, def] of Object.entries(argsDef)) {
    if (def.type !== "string" && def.type !== "enum") {
      continue;
    }
    if (normalizeFlag(key) === name) {
      return true;
    }
    if (toAliasArray(def.alias).some((alias) => normalizeFlag(alias) === name)) {
      return true;
    }
  }
  return false;
}

function normalizeFlag(value: string): string {
  return value.replace(/^-+/, "").replace(/-/g, "").toLowerCase();
}

async function findSubCommand(
  subCommands: SubCommandsDef,
  token: string,
): Promise<SubCommandMatch | null> {
  const direct = subCommands[token];
  if (direct !== undefined) {
    const command = await resolveCitty(direct);
    if (command === undefined) {
      return null;
    }
    const meta = await resolveCitty(command.meta);
    return { name: meta?.name ?? token, command };
  }
  for (const [key, loader] of Object.entries(subCommands)) {
    const command = await resolveCitty(loader);
    if (command === undefined) {
      continue;
    }
    const meta = await resolveCitty(command.meta);
    if (toAliasArray(meta?.alias).includes(token)) {
      return { name: meta?.name ?? key, command };
    }
  }
  return null;
}
