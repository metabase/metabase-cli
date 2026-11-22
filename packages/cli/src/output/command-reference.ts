import type { ArgsDef, CommandDef } from "citty";

import { ConfigError } from "@metabase/client/errors";
import {
  featureAvailability,
  featureImplies,
  type FeatureName,
} from "@metabase/client/version/features";

import {
  isShortAlias,
  kebabFlagName,
  LONG_PREFIX,
  NEGATION_PREFIX,
  resolveCitty,
  SHORT_PREFIX,
  toAliasArray,
} from "../runtime/citty";
import {
  buildHelpEntry,
  buildHelpIndex,
  CLI_NAME,
  convertArgs,
  OUTPUT_SCHEMA_FLAG,
  schemaCommand,
  skillCommand,
  type CommandHelpArg,
  type CommandHelpEntry,
  type CommandHelpSkill,
} from "../runtime/command-help";

// The name the Metabase docs site serves as a folder's own page.
const INDEX_PAGE = "index.md";
const PAGE_EXTENSION = ".md";
const INDEX_TITLE = "Metabase CLI command reference";
const INDEX_SUMMARY =
  "Each mb command, with its arguments, flags, examples, and the Metabase features it needs.";
const BODY_SCHEMA_COMMAND = schemaCommand("<command>");
const OUTPUT_SCHEMA_COMMAND = `${BODY_SCHEMA_COMMAND} ${OUTPUT_SCHEMA_FLAG}`;
const SCHEMAS_PARAGRAPH = `\`${BODY_SCHEMA_COMMAND}\` prints the JSON Schema of the body a command reads, and \`${OUTPUT_SCHEMA_COMMAND}\` the schema of what it prints.`;
const SHARED_FLAGS_INTRO =
  "Many commands take one or more of these flag sets. Each page names the sets its commands take.";
// A page says once what every one of its commands takes or needs only when there is more than
// one command to say it for.
const MIN_COMMANDS_TO_HOIST = 2;

const BLOCK_SEPARATOR = "\n\n";
const VALUE_PLACEHOLDER = "<value>";
const CODE_SPAN = /(`[^`]*`)/;
const SENTENCE_END = /[.!?]$/;
// GitHub's heading anchors, which kramdown and lychee read the same way for the plain-text
// headings this reference writes: lowercase, punctuation other than `-` and `_` dropped, each
// space a hyphen.
const ANCHOR_DROPPED = /[^a-z0-9 _-]/g;
const ANCHOR_SPACE = / /g;
const LIST_FORMAT = new Intl.ListFormat("en", { style: "long", type: "conjunction" });
// A command's details sit inside its own `##` section, so only a group's may head a section.
const MARKDOWN_HEADING = /^#{1,6} /m;
// The Metabase docs site runs Liquid over a page's body, which reads `{{snippet: Name}}` as a
// variable and prints nothing in its place; a raw tag keeps the text as written.
const LIQUID_OUTPUT = /\{\{[\s\S]*?\}\}/g;
const LIQUID_RAW = "{% raw %}$&{% endraw %}";

export interface SharedFlagSet {
  name: string;
  flags: ArgsDef;
}

interface ReferenceInput {
  root: CommandDef;
  // Largest first: a set is credited to a command only when no earlier set claimed its flags.
  sharedFlagSets: readonly SharedFlagSet[];
}

interface ReferenceCommand {
  entry: CommandHelpEntry;
  path: readonly string[];
  aliases: readonly string[];
  sharedSets: readonly SharedFlagSet[];
  ownArgs: readonly CommandHelpArg[];
  // Without the features another of them implies.
  features: readonly FeatureName[];
}

// What every command on a page takes and needs, which the page says once.
interface PageCommon {
  sets: readonly SharedFlagSet[];
  features: readonly FeatureName[];
}

const NOTHING_COMMON: PageCommon = { sets: [], features: [] };

interface GroupPage {
  kind: "group";
  file: string;
  name: string;
  description: string | null;
  details: string | null;
  aliases: readonly string[];
  defaultCommand: string | null;
  skills: readonly CommandHelpSkill[];
  common: PageCommon;
  commands: readonly ReferenceCommand[];
}

interface LeafPage {
  kind: "leaf";
  file: string;
  name: string;
  command: ReferenceCommand;
}

type ReferencePage = GroupPage | LeafPage;

interface CommandNode {
  key: string;
  command: CommandDef;
}

/**
 * The command reference as Markdown pages by file name: an index, then one page per top-level
 * command of `root`.
 */
export async function renderCommandReference(
  input: ReferenceInput,
): Promise<ReadonlyMap<string, string>> {
  const pages = await collectPages(input.root, input.sharedFlagSets);
  const rootIndex = await buildHelpIndex(input.root, []);
  const files = new Map<string, string>([
    [INDEX_PAGE, renderIndex(rootIndex.skills, pages, input.sharedFlagSets)],
  ]);
  for (const page of pages) {
    files.set(page.file, renderPage(page));
  }
  return files;
}

export function anchorFor(heading: string): string {
  return heading.toLowerCase().replace(ANCHOR_DROPPED, "").replace(ANCHOR_SPACE, "-");
}

async function collectPages(
  root: CommandDef,
  sets: readonly SharedFlagSet[],
): Promise<ReferencePage[]> {
  const pages: ReferencePage[] = [];
  for (const node of await visibleSubCommands(root)) {
    pages.push(await collectPage(node, sets));
  }
  return pages;
}

async function collectPage(
  node: CommandNode,
  sets: readonly SharedFlagSet[],
): Promise<ReferencePage> {
  const path = [node.key];
  const file = `${node.key}${PAGE_EXTENSION}`;
  if (!(await isGroup(node.command))) {
    return {
      kind: "leaf",
      file,
      name: node.key,
      command: await collectCommand(node.command, path, sets),
    };
  }
  const meta = await resolveCitty(node.command.meta);
  const index = await buildHelpIndex(node.command, path);
  const defaultCommand = await resolveCitty(node.command.default);
  const commands = await collectCommands(node.command, path, sets);
  return {
    kind: "group",
    file,
    name: node.key,
    description: index.description,
    details: index.details ?? null,
    aliases: toAliasArray(meta?.alias),
    defaultCommand: defaultCommand ?? null,
    skills: index.skills,
    common: pageCommon(commands, sets),
    commands,
  };
}

async function collectCommands(
  group: CommandDef,
  path: readonly string[],
  sets: readonly SharedFlagSet[],
): Promise<ReferenceCommand[]> {
  const commands: ReferenceCommand[] = [];
  for (const node of await visibleSubCommands(group)) {
    const nodePath = [...path, node.key];
    if (await isGroup(node.command)) {
      commands.push(...(await collectCommands(node.command, nodePath, sets)));
    } else {
      commands.push(await collectCommand(node.command, nodePath, sets));
    }
  }
  return commands;
}

async function collectCommand(
  command: CommandDef,
  path: readonly string[],
  sets: readonly SharedFlagSet[],
): Promise<ReferenceCommand> {
  const entry = await buildHelpEntry(command, [...path]);
  if (entry.details !== undefined && MARKDOWN_HEADING.test(entry.details)) {
    throw new ConfigError(
      `${commandName(path)} has a heading in its details, which only a group's details may hold`,
    );
  }
  const meta = await resolveCitty(command.meta);
  const argsDef = await resolveCitty(command.args);
  const sharedSets = argsDef === undefined ? [] : takenSharedSets(argsDef, sets);
  const sharedKeys = new Set(sharedSets.flatMap((set) => Object.keys(set.flags)));
  return {
    entry,
    path,
    aliases: toAliasArray(meta?.alias),
    sharedSets,
    ownArgs: entry.args.filter((arg) => !sharedKeys.has(arg.name)),
    features: entry.requires === null ? [] : essentialFeatures(entry.requires.features),
  };
}

// Commands spread a shared set into their args, which keeps each flag's definition the very
// object the set holds; a command that redefines one of the set's flags holds its own object, and
// documents that flag itself.
function takenSharedSets(argsDef: ArgsDef, sets: readonly SharedFlagSet[]): SharedFlagSet[] {
  const claimed = new Set<string>();
  const taken: SharedFlagSet[] = [];
  for (const set of sets) {
    const keys = Object.keys(set.flags);
    const takesSet = keys.every((key) => !claimed.has(key) && argsDef[key] === set.flags[key]);
    if (takesSet) {
      taken.push(set);
      for (const key of keys) {
        claimed.add(key);
      }
    }
  }
  return taken;
}

// A feature that another one in the list implies says nothing the other doesn't. Two that imply
// each other hold on the same servers but name different behaviours, so both stay.
function essentialFeatures(features: readonly FeatureName[]): FeatureName[] {
  return features.filter(
    (feature) =>
      !features.some((other) => featureImplies(other, feature) && !featureImplies(feature, other)),
  );
}

function pageCommon(
  commands: readonly ReferenceCommand[],
  sets: readonly SharedFlagSet[],
): PageCommon {
  if (commands.length < MIN_COMMANDS_TO_HOIST) {
    return NOTHING_COMMON;
  }
  const candidates = [...new Set(commands.flatMap((command) => command.features))];
  const features = candidates.filter((feature) =>
    commands.every((command) => command.features.some((own) => featureImplies(own, feature))),
  );
  return {
    sets: sets.filter((set) => commands.every((command) => command.sharedSets.includes(set))),
    features: essentialFeatures(features),
  };
}

async function visibleSubCommands(cmd: CommandDef): Promise<CommandNode[]> {
  const subCommands = await resolveCitty(cmd.subCommands);
  if (subCommands === undefined) {
    return [];
  }
  const nodes: CommandNode[] = [];
  for (const [key, lazy] of Object.entries(subCommands)) {
    const command = await resolveCitty(lazy);
    if (command === undefined) {
      continue;
    }
    const meta = await resolveCitty(command.meta);
    if (meta?.hidden !== true) {
      nodes.push({ key, command });
    }
  }
  return nodes;
}

async function isGroup(cmd: CommandDef): Promise<boolean> {
  const subCommands = await resolveCitty(cmd.subCommands);
  return subCommands !== undefined && Object.keys(subCommands).length > 0;
}

function renderIndex(
  skills: readonly CommandHelpSkill[],
  pages: readonly ReferencePage[],
  sets: readonly SharedFlagSet[],
): string {
  return pageText(frontMatter(INDEX_TITLE, INDEX_SUMMARY), [
    `# ${INDEX_TITLE}`,
    ...skillsBlocks(skills),
    "## Commands",
    commandTable(pages),
    SCHEMAS_PARAGRAPH,
    "## Shared flags",
    SHARED_FLAGS_INTRO,
    ...sets.flatMap((set) => [`### ${sharedSetHeading(set)}`, argTable(convertArgs(set.flags))]),
  ]);
}

function renderPage(page: ReferencePage): string {
  const title = commandName([page.name]);
  if (page.kind === "leaf") {
    const description = page.command.entry.description;
    return pageText(frontMatter(title, description), [
      `# ${title}`,
      ...descriptionBlocks(description),
      ...commandBlocks(page.command, NOTHING_COMMON),
    ]);
  }
  return pageText(frontMatter(title, page.description), [
    `# ${title}`,
    ...descriptionBlocks(page.description),
    ...aliasBlocks([], page.aliases),
    ...defaultCommandBlocks(page.name, page.defaultCommand),
    ...pageCommonBlocks(page.common),
    ...skillsBlocks(page.skills),
    ...detailsBlocks(page.details),
    ...page.commands.flatMap((command) => [
      `## ${commandName(command.path)}`,
      ...descriptionBlocks(command.entry.description),
      ...commandBlocks(command, page.common),
    ]),
  ]);
}

function commandBlocks(command: ReferenceCommand, common: PageCommon): string[] {
  const { entry } = command;
  const positionals = command.ownArgs.filter((arg) => arg.type === "positional");
  const flags = command.ownArgs.filter((arg) => arg.type !== "positional");
  const takesFlags = flags.length > 0 || command.sharedSets.length > 0;
  return [
    ...aliasBlocks(command.path.slice(0, -1), command.aliases),
    ...detailsBlocks(entry.details ?? null),
    usageBlock(command.path, positionals, takesFlags),
    ...(command.ownArgs.length === 0 ? [] : [argTable([...positionals, ...flags])]),
    ...sharedSetBlocks(command.sharedSets, common.sets),
    ...requirementBlocks(command.features, common.features),
    ...skillsBlocks(entry.skills),
    ...exampleBlocks(entry.examples),
  ];
}

function frontMatter(title: string, summary: string | null): string {
  // A JSON string is a YAML double-quoted scalar, so any text survives the round trip.
  const lines = ["---", `title: ${JSON.stringify(title)}`];
  if (summary !== null) {
    lines.push(`summary: ${JSON.stringify(sentence(summary))}`);
  }
  lines.push("---");
  return lines.join("\n");
}

function descriptionBlocks(description: string | null): string[] {
  return description === null ? [] : [sentence(escapeText(description))];
}

function aliasBlocks(parent: readonly string[], aliases: readonly string[]): string[] {
  if (aliases.length === 0) {
    return [];
  }
  const label = aliases.length === 1 ? "Alias" : "Aliases";
  const names = aliases.map((alias) => code(commandName([...parent, alias])));
  return [`${label}: ${names.join(", ")}.`];
}

function defaultCommandBlocks(name: string, defaultCommand: string | null): string[] {
  if (defaultCommand === null) {
    return [];
  }
  const group = code(commandName([name]));
  const runs = code(commandName([name, defaultCommand]));
  return [`Without a command, ${group} runs ${runs}.`];
}

function pageCommonBlocks(common: PageCommon): string[] {
  const blocks: string[] = [];
  if (common.sets.length > 0) {
    blocks.push(`Every command on this page takes the ${setLinks(common.sets)} flags.`);
  }
  if (common.features.length > 0) {
    blocks.push(`Every command on this page needs ${featureList(common.features)}.`);
  }
  return blocks;
}

function detailsBlocks(details: string | null): string[] {
  return details === null ? [] : [escapeText(details)];
}

function skillsBlocks(skills: readonly CommandHelpSkill[]): string[] {
  if (skills.length === 0) {
    return [];
  }
  const items = skills.map(
    (pointer) => `- ${code(skillCommand(pointer.skill))}: ${escapeText(pointer.purpose)}`,
  );
  return ["Agent skills:", items.join("\n")];
}

function usageBlock(
  path: readonly string[],
  positionals: readonly CommandHelpArg[],
  takesFlags: boolean,
): string {
  const tokens = [commandName(path), ...positionals.map(positionalToken)];
  if (takesFlags) {
    tokens.push("[flags]");
  }
  return shellBlock([tokens.join(" ")]);
}

function positionalToken(arg: CommandHelpArg): string {
  return arg.required ? `<${arg.name}>` : `[${arg.name}]`;
}

function argTable(args: readonly CommandHelpArg[]): string {
  return table(
    [argColumnHeading(args), "Description"],
    args.map((arg) => [code(argSpelling(arg)), argDescription(arg)]),
  );
}

function argColumnHeading(args: readonly CommandHelpArg[]): string {
  const positionals = args.filter((arg) => arg.type === "positional").length;
  if (positionals === args.length) {
    return "Argument";
  }
  return positionals === 0 ? "Flag" : "Argument or flag";
}

function argSpelling(arg: CommandHelpArg): string {
  return arg.type === "positional" ? positionalToken(arg) : flagSpelling(arg);
}

// The spellings citty binds that a reader needs: the one-letter alias, the kebab-case name (and
// any other long alias), the value it takes, and the negation a flag that defaults to on is
// turned off with.
function flagSpelling(arg: CommandHelpArg): string {
  const aliases = toAliasArray(arg.alias);
  const short = aliases.filter(isShortAlias).map((alias) => `${SHORT_PREFIX}${alias}`);
  const longNames = new Set([
    kebabFlagName(arg.name),
    ...aliases.filter((alias) => !isShortAlias(alias)),
  ]);
  const long = [...longNames].map((name) => `${LONG_PREFIX}${name}`);
  const spelling = [...short, ...long].join(", ");
  if (arg.type === "string" || arg.type === "enum") {
    return `${spelling} ${VALUE_PLACEHOLDER}`;
  }
  if (arg.default === true) {
    return `${spelling}, ${NEGATION_PREFIX}${kebabFlagName(arg.name)}`;
  }
  return spelling;
}

function argDescription(arg: CommandHelpArg): string {
  const parts: string[] = [];
  if (arg.required && arg.type !== "positional") {
    parts.push("Required.");
  }
  if (arg.description !== undefined) {
    parts.push(sentence(escapeCell(arg.description)));
  }
  if (arg.options !== undefined) {
    parts.push(`One of ${arg.options.map(code).join(", ")}.`);
  }
  // A flag that is off unless given has nothing to say about its default.
  if (arg.default !== undefined && arg.default !== false) {
    parts.push(`Default: ${code(String(arg.default))}.`);
  }
  return parts.join(" ");
}

function sharedSetBlocks(
  sets: readonly SharedFlagSet[],
  pageSets: readonly SharedFlagSet[],
): string[] {
  const own = sets.filter((set) => !pageSets.includes(set));
  if (own.length === 0) {
    return [];
  }
  const verb = pageSets.length === 0 ? "Takes" : "Also takes";
  return [`${verb} the ${setLinks(own)} flags.`];
}

function setLinks(sets: readonly SharedFlagSet[]): string {
  return LIST_FORMAT.format(
    sets.map((set) => `[${set.name}](${INDEX_PAGE}#${anchorFor(sharedSetHeading(set))})`),
  );
}

function sharedSetHeading(set: SharedFlagSet): string {
  return `${set.name.charAt(0).toUpperCase()}${set.name.slice(1)} flags`;
}

function requirementBlocks(
  features: readonly FeatureName[],
  pageFeatures: readonly FeatureName[],
): string[] {
  const own = features.filter((feature) => !pageFeatures.includes(feature));
  if (own.length === 0) {
    return [];
  }
  const verb = pageFeatures.length === 0 ? "Needs" : "Also needs";
  return [`${verb} ${featureList(own)}.`];
}

function featureList(features: readonly FeatureName[]): string {
  return LIST_FORMAT.format(features.map(featureMention));
}

function featureMention(feature: FeatureName): string {
  return `${code(feature)} (${featureAvailability(feature)})`;
}

function exampleBlocks(examples: readonly string[]): string[] {
  return examples.length === 0 ? [] : ["Examples:", shellBlock(examples)];
}

function commandTable(pages: readonly ReferencePage[]): string {
  return table(
    ["Command", "Description"],
    pages.map((page) => {
      const description = page.kind === "leaf" ? page.command.entry.description : page.description;
      const link = `[${commandName([page.name])}](${page.file})`;
      return [link, description === null ? "" : sentence(escapeCell(description))];
    }),
  );
}

function table(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const lines = [header, header.map(() => "---"), ...rows].map(
    (cells) => `| ${cells.map(escapePipes).join(" | ")} |`,
  );
  return lines.join("\n");
}

function shellBlock(lines: readonly string[]): string {
  return ["```sh", ...lines, "```"].join("\n");
}

function commandName(path: readonly string[]): string {
  return [CLI_NAME, ...path].join(" ");
}

function code(text: string): string {
  return `\`${text}\``;
}

function sentence(text: string): string {
  return SENTENCE_END.test(text) ? text : `${text}.`;
}

// Liquid reads the body only, so the YAML front matter keeps its text as it is.
function pageText(front: string, body: readonly string[]): string {
  const blocks = [front, ...body.map((block) => block.replaceAll(LIQUID_OUTPUT, LIQUID_RAW))];
  return `${blocks.join(BLOCK_SEPARATOR)}\n`;
}

// Markdown reads a `<` outside a code span as the start of an HTML tag, which GitHub then strips,
// so `"<db-id>:<schema>"` would render as `":"`.
function escapeText(text: string): string {
  // Splitting on a capturing pattern alternates the text between code spans with the spans.
  return text
    .split(CODE_SPAN)
    .map((part, index) => (isOdd(index) ? part : part.replaceAll("<", "&lt;")))
    .join("");
}

function isOdd(index: number): boolean {
  return index % 2 === 1;
}

function escapeCell(text: string): string {
  return escapeText(text).replaceAll("\n", " ");
}

// A table cell ends at a bare `|`, inside a code span too, so every pipe in a cell is escaped.
function escapePipes(cell: string): string {
  return cell.replaceAll("|", "\\|");
}
