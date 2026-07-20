import { renderUsage } from "citty";
import type { ArgsDef, CommandDef, SubCommandsDef } from "citty";

import { flagConsumesValue, resolveCitty, toAliasArray } from "../runtime/citty";
import { getMetabaseAugment, type SkillPointer } from "../runtime/command-augment";
import { buildHelpEntry, buildHelpIndex } from "../runtime/command-help";
import { jsonLine } from "./render";

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

const CLI_NAME = "mb";

const HELP_FLAG_SPEC = "-h, --help";
const HELP_FLAG_DESCRIPTION = "Show help for this command";

const GETTING_STARTED_HINT = `First time? Run \`${CLI_NAME} auth login\` to connect to a Metabase instance.`;

const SKILLS_HEADER = "AGENT SKILLS";
const SKILLS_LIST_ITEM = `${CLI_NAME} skills list — every bundled skill`;

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

  const augment = getMetabaseAugment(cmd);
  const details = augment?.details ?? null;
  const examples = augment?.examples ?? [];
  const skills = augment?.skills ?? [];

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
  if (skills.length > 0) {
    sections.push(renderSkillsSection(skills, isRoot));
  }
  if (isRoot) {
    sections.push(GETTING_STARTED_HINT);
  }
  sections.push(machineHelpHint(breadcrumb ?? cittyName, hasSubCommands));
  await writeUsage(sections.join("\n\n") + "\n");
}

export async function showUsageJson<T extends ArgsDef = ArgsDef>(
  cmd: CommandDef<T>,
  breadcrumb: string,
): Promise<void> {
  const path = breadcrumbPath(breadcrumb);
  const subCommands = await resolveCitty(cmd.subCommands);
  const hasSubCommands = subCommands !== undefined && Object.keys(subCommands).length > 0;
  const payload = hasSubCommands
    ? await buildHelpIndex(cmd, path)
    : await buildHelpEntry(cmd, path);
  await writeUsage(jsonLine(payload));
}

// Citty exits the process right after the showUsage hook returns, which discards any stdout
// still buffered inside Node — a fire-and-forget write truncates payloads over the pipe
// buffer size. Resolving on the write callback guarantees the data reached the OS first.
function writeUsage(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    process.stdout.write(text, (error) => (error ? reject(error) : resolve()));
  });
}

function breadcrumbPath(breadcrumb: string): string[] {
  const segments = breadcrumb.split(" ").filter((segment) => segment.length > 0);
  return segments[0] === CLI_NAME ? segments.slice(1) : segments;
}

const MACHINE_HELP_LEAF_LABEL = "Machine-readable help (flags, output schema):";
const MACHINE_HELP_INDEX_LABEL = "Machine-readable command index:";

function machineHelpHint(breadcrumb: string, hasSubCommands: boolean): string {
  const label = hasSubCommands ? MACHINE_HELP_INDEX_LABEL : MACHINE_HELP_LEAF_LABEL;
  return `${label} ${breadcrumb} --help --json`;
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

export function renderSkillsSection(
  skills: readonly SkillPointer[],
  includeListPointer: boolean,
): string {
  const items = skills.map((p) => `${LINE_PREFIX}mb skills get ${p.skill} — ${p.purpose}`);
  if (includeListPointer) {
    items.push(`${LINE_PREFIX}${SKILLS_LIST_ITEM}`);
  }
  return [SKILLS_HEADER, "", ...items].join("\n");
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

interface SubCommandMatch {
  name: string;
  command: CommandDef;
}

interface CommandPath {
  segments: string[];
  unknownToken: string | null;
}

// Citty's renderUsage only knows a command's immediate parent, so the leaf USAGE line drops
// the ancestry above it. Citty's own path walk (resolveSubCommand/findSubCommandIndex) is not
// exported, so we re-walk the tree from the root against rawArgs to recover the full breadcrumb
// (and to detect an unknown subcommand before citty's own colored handler fires).
async function walkCommandPath(root: CommandDef, rawArgs: readonly string[]): Promise<CommandPath> {
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
      return { segments, unknownToken: token };
    }
    segments.push(match.name);
    current = match.command;
    index += 1;
  }
  return { segments, unknownToken: null };
}

export async function resolveBreadcrumb(
  root: CommandDef,
  rawArgs: readonly string[],
): Promise<string> {
  const { segments } = await walkCommandPath(root, rawArgs);
  return segments.length > 0 ? segments.join(" ") : CLI_NAME;
}

export async function findUnknownCommand(
  root: CommandDef,
  rawArgs: readonly string[],
): Promise<string | null> {
  return (await walkCommandPath(root, rawArgs)).unknownToken;
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
    if (flagConsumesValue(token, argsDef)) {
      index += 1;
    }
    index += 1;
  }
  return index;
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
