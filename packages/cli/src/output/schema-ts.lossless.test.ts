import { isDeepStrictEqual } from "node:util";

import { describe, expect, it } from "vitest";
import type { ZodType } from "zod";

import { schemaJson } from "../commands/schema";
import {
  getQuerySchemaBundle,
  QUERY_SCHEMA_DOCUMENT,
  validateQuery,
} from "../core/schema/validate";
import main from "../main";
import { getMetabaseAugment } from "../runtime/command-augment";
import { buildHelpIndex, resolveCommandPath } from "../runtime/command-help";
import { REFINED_PREFIX } from "../runtime/json-schema";
import { compileTypeScript } from "../testing/compile-typescript";
import {
  generateSample,
  isJsonObject,
  type Json,
  type Path,
  type Sample,
  type SampleSource,
  type Site,
  statedTypes,
  type TypeName,
} from "../testing/schema-samples";
import {
  childLocation,
  isStatedBound,
  renderTypeScriptWithNotes,
  type RenderedTypeScript,
  Schema,
  type SchemaLocation,
  type SchemaNode,
} from "./schema-ts";

type Family = "command" | "mbql";

interface Contract extends SampleSource {
  readonly name: string;
  readonly family: Family;
  readonly typeName: string;
  readonly accepts: (value: Json) => boolean;
  readonly refinedBy: (value: Json) => readonly string[];
  readonly render: () => RenderedTypeScript;
}

type MutationKind =
  | "wrong-type"
  | "bad-enum"
  | "out-of-range"
  | "non-integer"
  | "too-short-string"
  | "too-long-string"
  | "pattern"
  | "bad-tuple-head"
  | "tuple-too-short"
  | "tuple-too-long"
  | "array-count"
  | "missing-required"
  | "extra-key-strict"
  | "extra-key-open"
  | "bad-record-key"
  | "refinement";

interface MemberRule {
  readonly kind: "member";
  readonly location: SchemaLocation;
  readonly statingNote: string | null;
}

interface BranchRule {
  readonly kind: "branch";
  readonly site: Site;
}

interface RefinementRule {
  readonly kind: "refinement";
  readonly metLocations: readonly SchemaLocation[];
}

type Rule = MemberRule | BranchRule | RefinementRule;

interface Edit {
  readonly kind: MutationKind;
  readonly detail: string;
  readonly replacement: Json;
  readonly rule: Rule;
}

interface Mutation {
  readonly contract: Contract;
  readonly path: Path;
  readonly kind: MutationKind;
  readonly detail: string;
  readonly value: Json;
  readonly rule: Rule;
}

interface CaughtByType {
  readonly kind: "caught-by-type";
}

interface CaughtByNote {
  readonly kind: "caught-by-note";
}

type SilentReason =
  | "no member at this path"
  | "no note states this rule"
  | "the member prints no note"
  | "the note omits the rule";

interface Silent {
  readonly kind: "silent";
  readonly reason: SilentReason;
}

type Verdict = CaughtByType | CaughtByNote | Silent;

interface Judgement {
  readonly mutation: Mutation;
  readonly verdict: Verdict;
}

interface SilentRow {
  readonly contract: string;
  readonly path: string;
  readonly mutation: string;
  readonly value: string;
  readonly reason: SilentReason;
}

interface TypeCheckFailure {
  readonly where: string;
  readonly detail: string;
}

interface Refinement {
  readonly path: Path;
  readonly value: Json;
  readonly detail: string;
}

interface Probe {
  readonly line: number;
  readonly value: Json;
}

interface MutationProbe extends Probe {
  readonly mutation: Mutation;
}

type NoteIndex = ReadonlyMap<string, readonly string[]>;

interface ContractRun {
  readonly contract: Contract;
  readonly file: string;
  readonly source: string;
  readonly notes: NoteIndex;
  readonly samples: readonly Probe[];
  readonly mutations: readonly MutationProbe[];
}

interface FuzzRun {
  readonly judgements: readonly Judgement[];
  readonly refined: readonly string[];
  readonly typeCheckFailures: readonly TypeCheckFailure[];
  readonly unexercised: readonly string[];
}

const COMMAND_ATTEMPTS = 5;
const MBQL_ATTEMPTS = 100;

const PREVIEW_CHARS = 200;
// Both inclusive bounds, when non-negative, print together as one `min-max` note.
const BOUNDS = [
  { keyword: "minimum", offset: -1, note: ">=", spans: true },
  { keyword: "exclusiveMinimum", offset: 0, note: ">", spans: false },
  { keyword: "maximum", offset: 1, note: "<=", spans: true },
  { keyword: "exclusiveMaximum", offset: 0, note: "<", spans: false },
] as const;
const CONDITIONAL_KEYWORDS = ["if", "then", "else"] as const;

const WRONG_SCALARS: readonly Json[] = [12345, "zz", true, null];
const WRONG_OBJECT: Json = { zz: 1 };
const WRONG_ARRAY: Json = [1];
const NOT_A_MEMBER_NUMBER = 987654;
const NOT_A_MEMBER_STRING = "zz-not-a-member";
const NOT_AN_OPERATOR = "zz-op";
const FILLER_ELEMENT = 1;
const EXTRA_KEY = "zz_extra";
const BAD_RECORD_KEY = "zz bad key";
const BAD_STRINGS = [" ", "", "zz", "0", "}"];
const NON_INTEGER_OFFSET = 0.5;
const TAG_KEYS = ["lib/type", "type", "strategy"];

const VALID_MBQL: Json = {
  "lib/type": "mbql/query",
  database: 1,
  stages: [{ "lib/type": "mbql.stage/mbql", "source-table": 1 }],
};
const VALID_DOCUMENT: Json = { type: "doc" };
const VALID_VERSION = "1.2.3";
const VERSION_SUFFIX = "Version";

const DATASET_QUERY_REFINEMENT: Refinement = {
  path: ["dataset_query"],
  value: { database: 1 },
  detail: "dataset_query without lib/type or type",
};
const EMPTY_PATCH: Refinement = { path: [], value: {}, detail: "empty patch" };
const ANONYMOUS_NODE: Refinement = {
  path: ["document"],
  value: { type: "paragraph" },
  detail: "paragraph node without attrs._id",
};
const BAD_VERSION: Refinement = {
  path: ["currentVersion"],
  value: "not-a-version",
  detail: "non-semver currentVersion",
};
const REFINEMENTS: ReadonlyMap<string, readonly Refinement[]> = new Map([
  ["card create input", [DATASET_QUERY_REFINEMENT]],
  ["card update input", [DATASET_QUERY_REFINEMENT]],
  ["data-action create input", [DATASET_QUERY_REFINEMENT]],
  ["data-action update input", [DATASET_QUERY_REFINEMENT]],
  ["dashboard update-dashcard input", [EMPTY_PATCH]],
  ["collection update input", [EMPTY_PATCH]],
  ["document create input", [ANONYMOUS_NODE]],
  ["document update input", [ANONYMOUS_NODE]],
  ["upgrade output", [BAD_VERSION]],
]);

const SIDES = { input: "Input", output: "Output" } as const;
type Side = keyof typeof SIDES;

const CAUGHT_BY_TYPE: CaughtByType = { kind: "caught-by-type" };
const CAUGHT_BY_NOTE: CaughtByNote = { kind: "caught-by-note" };

function silent(reason: SilentReason): Silent {
  return { kind: "silent", reason };
}

function jsonType(value: Json | undefined): string {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  return typeof value;
}

function valueTypes(types: readonly TypeName[]): readonly string[] {
  return types.map((type) => (type === "integer" ? "number" : type));
}

function childOf(value: Json | undefined, segment: string | number): Json | undefined {
  if (Array.isArray(value) && typeof segment === "number") {
    return value[segment];
  }
  if (isJsonObject(value) && typeof segment === "string") {
    return value[segment];
  }
  return undefined;
}

function valueAt(value: Json, path: Path): Json | undefined {
  return path.reduce<Json | undefined>(childOf, value);
}

function replaced(root: Json, path: Path, next: Json): Json {
  const [head, ...rest] = path;
  if (head === undefined) {
    return next;
  }
  const child = childOf(root, head);
  if (Array.isArray(root) && child !== undefined) {
    const updated = replaced(child, rest, next);
    return root.map((item, index) => (index === head ? updated : item));
  }
  if (isJsonObject(root) && (child !== undefined || rest.length === 0)) {
    return { ...root, [head]: child === undefined ? next : replaced(child, rest, next) };
  }
  throw new Error(`no ${String(head)} in ${JSON.stringify(root)}`);
}

function locationKey({ document, pointer }: SchemaLocation): string {
  return `${document}#${pointer}`;
}

function stating(location: SchemaLocation, token: string | null): MemberRule {
  return { kind: "member", location, statingNote: token };
}

function countToken(
  minimum: number | undefined,
  maximum: number | undefined,
  unit: string,
): string | null {
  const lower = minimum === 0 ? undefined : minimum;
  if (lower === undefined) {
    return maximum === undefined ? null : `<=${maximum} ${unit}`;
  }
  if (maximum === undefined) {
    return `>=${lower} ${unit}`;
  }
  return lower === maximum ? `${lower} ${unit}` : `${lower}-${maximum} ${unit}`;
}

function lengthToken(node: SchemaNode): string | null {
  if (node.minLength === 1 && node.maxLength === undefined) {
    return "non-empty";
  }
  return countToken(node.minLength, node.maxLength, "chars");
}

function patternToken(pattern: string): string {
  return `/${pattern}/`;
}

function spannedToken(node: SchemaNode): string | null {
  const { minimum, maximum, exclusiveMinimum, exclusiveMaximum } = node;
  const exclusive = exclusiveMinimum !== undefined || exclusiveMaximum !== undefined;
  if (!isStatedBound(minimum) || !isStatedBound(maximum) || minimum < 0 || exclusive) {
    return null;
  }
  return `${minimum}-${maximum}`;
}

interface BoundBreak {
  readonly detail: string;
  readonly breach: number;
  readonly token: string;
}

function boundBreaks(node: SchemaNode): BoundBreak[] {
  const spanned = spannedToken(node);
  return BOUNDS.flatMap(({ keyword, offset, note, spans }) => {
    const bound = node[keyword];
    if (!isStatedBound(bound)) {
      return [];
    }
    const token = spans && spanned !== null ? spanned : `${note}${bound}`;
    return [{ detail: `${keyword} ${bound}`, breach: bound + offset, token }];
  });
}

function edit(kind: MutationKind, detail: string, replacement: Json, rule: Rule): Edit {
  return { kind, detail, replacement, rule };
}

function editsAt(site: Site, here: Json): Edit[] {
  return [
    ...wrongTypes(site),
    ...nonMembers(site),
    ...numberBreaks(site, here),
    ...stringBreaks(site, here),
    ...arrayBreaks(site, here),
    ...objectBreaks(site, here),
  ];
}

function wrongTypes(site: Site): Edit[] {
  const types = valueTypes(site.types);
  if (types.length === 0) {
    return [];
  }
  const scalar = WRONG_SCALARS.find((candidate) => !types.includes(jsonType(candidate)));
  const object = types.includes("object") ? undefined : WRONG_OBJECT;
  const array = types.includes("array") ? undefined : WRONG_ARRAY;
  const rule: BranchRule = { kind: "branch", site };
  return [scalar, object, array]
    .filter((wrong) => wrong !== undefined)
    .map((wrong) =>
      edit("wrong-type", `${types.join("|")} <- ${JSON.stringify(wrong)}`, wrong, rule),
    );
}

function nonMembers(site: Site): Edit[] {
  const { node } = site;
  const sample = node.enum === undefined ? node.const : node.enum[0];
  if (sample === undefined || site.position.kind === "tuple-head") {
    return [];
  }
  const detail = `enum ${JSON.stringify(node.enum ?? node.const)}`;
  const replacement = typeof sample === "number" ? NOT_A_MEMBER_NUMBER : NOT_A_MEMBER_STRING;
  return [edit("bad-enum", detail, replacement, { kind: "branch", site })];
}

function numberBreaks(site: Site, here: Json): Edit[] {
  if (typeof here !== "number") {
    return [];
  }
  const { node, location } = site;
  const ranges = boundBreaks(node).map(({ detail, breach, token }) =>
    edit("out-of-range", detail, breach, stating(location, token)),
  );
  const integral = site.types.includes("integer") && !site.types.includes("number");
  const fraction = here + NON_INTEGER_OFFSET;
  const fractional = edit("non-integer", "integer", fraction, stating(location, "int"));
  return integral ? [...ranges, fractional] : ranges;
}

function stringBreaks(site: Site, here: Json): Edit[] {
  if (typeof here !== "string") {
    return [];
  }
  const { node, location } = site;
  const length = stating(location, lengthToken(node));
  const edits: Edit[] = [];
  if (node.minLength !== undefined && node.minLength > 0) {
    const short = "a".repeat(node.minLength - 1);
    edits.push(edit("too-short-string", `minLength ${node.minLength}`, short, length));
  }
  if (node.maxLength !== undefined) {
    const long = "a".repeat(node.maxLength + 1);
    edits.push(edit("too-long-string", `maxLength ${node.maxLength}`, long, length));
  }
  if (node.pattern === undefined) {
    return edits;
  }
  const pattern = new RegExp(node.pattern, "u");
  const minLength = node.minLength ?? 0;
  const bad = BAD_STRINGS.find((text) => !pattern.test(text) && text.length >= minLength);
  if (bad !== undefined) {
    const rule = stating(location, patternToken(node.pattern));
    edits.push(edit("pattern", `pattern /${node.pattern}/`, bad, rule));
  }
  return edits;
}

function arrayBreaks(site: Site, here: Json): Edit[] {
  if (!Array.isArray(here)) {
    return [];
  }
  const { node, location } = site;
  if (node.prefixItems !== undefined) {
    return tupleBreaks(stating(location, null), node.prefixItems, here);
  }
  const [head] = here;
  if (head === undefined) {
    return [];
  }
  const count = stating(location, countToken(node.minItems, node.maxItems, "items"));
  const edits: Edit[] = [];
  if (node.minItems !== undefined && node.minItems > 0) {
    const fewer = here.slice(0, node.minItems - 1);
    edits.push(edit("array-count", `minItems ${node.minItems}`, fewer, count));
  }
  if (node.maxItems !== undefined) {
    const padding = Array.from({ length: node.maxItems + 1 - here.length }, () => head);
    edits.push(edit("array-count", `maxItems ${node.maxItems}`, [...here, ...padding], count));
  }
  return edits;
}

function tupleBreaks(
  unstated: MemberRule,
  prefix: readonly Schema[],
  here: readonly Json[],
): Edit[] {
  const [head] = prefix;
  const tag =
    head === undefined || typeof head === "boolean" ? undefined : (head.const ?? head.enum);
  const retagged = here.map((item, index) => (index === 0 ? NOT_AN_OPERATOR : item));
  const longer = [...here, here.at(-1) ?? FILLER_ELEMENT];
  return [
    ...(tag === undefined
      ? []
      : [edit("bad-tuple-head", `head ${JSON.stringify(tag)}`, retagged, unstated)]),
    ...(here.length === 0
      ? []
      : [edit("tuple-too-short", `length ${here.length - 1}`, here.slice(0, -1), unstated)]),
    edit("tuple-too-long", `length ${longer.length}`, longer, unstated),
  ];
}

function objectBreaks(site: Site, here: Json): Edit[] {
  if (!isJsonObject(here)) {
    return [];
  }
  const { node, location } = site;
  const unstated = stating(location, null);
  const entries = Object.entries(here);
  const extended = { ...here, [EXTRA_KEY]: 1 };
  const edits = (node.required ?? [])
    .filter((key) => key in here)
    .map((key) => {
      const without = Object.fromEntries(entries.filter(([name]) => name !== key));
      return edit("missing-required", `required ${key}`, without, unstated);
    });
  if (node.additionalProperties === false) {
    edits.push(edit("extra-key-strict", "additionalProperties false", extended, unstated));
  }
  const names = node.propertyNames;
  if (names !== undefined && node.properties === undefined && entries.length > 0) {
    const renamed = Object.fromEntries(
      entries.map(([name, item], index) => [index === 0 ? BAD_RECORD_KEY : name, item]),
    );
    const pattern = typeof names === "boolean" ? undefined : names.pattern;
    const keys = childLocation(location, "propertyNames");
    const rule = stating(keys, pattern === undefined ? null : patternToken(pattern));
    edits.push(edit("bad-record-key", "propertyNames", renamed, rule));
  }
  const extra = node.additionalProperties;
  const open =
    extra === undefined ||
    extra === true ||
    (typeof extra !== "boolean" && Object.keys(extra).length === 0);
  if (open && Object.keys(node.properties ?? {}).length > 0) {
    edits.push(edit("extra-key-open", "open object", extended, unstated));
  }
  return edits;
}

function tagOf(here: Json): string {
  if (Array.isArray(here)) {
    const [head] = here;
    return typeof head === "string" ? head : "";
  }
  if (isJsonObject(here)) {
    return TAG_KEYS.map((key) => String(here[key])).join("/");
  }
  return "";
}

function mutationsOf(contract: Contract, samples: readonly Sample[]): Mutation[] {
  const done = new Set<string>();
  const mutations: Mutation[] = [];
  for (const sample of samples) {
    for (const site of sample.sites) {
      const here = valueAt(sample.value, site.path);
      if (here === undefined) {
        continue;
      }
      for (const { kind, detail, replacement, rule } of editsAt(site, here)) {
        const key = `${locationKey(site.location)}|${kind}|${detail}|${tagOf(here)}`;
        if (done.has(key)) {
          continue;
        }
        const value = replaced(sample.value, site.path, replacement);
        if (contract.accepts(value)) {
          continue;
        }
        done.add(key);
        mutations.push({ contract, path: site.path, kind, detail, value, rule });
      }
    }
  }
  return mutations;
}

function refinementMutations(contract: Contract, samples: readonly Sample[]): Mutation[] {
  const [fallback] = samples;
  if (fallback === undefined) {
    return [];
  }
  return (REFINEMENTS.get(contract.name) ?? []).map(({ path, value, detail }) => {
    const holder = samples.map((sample) => memberAt(sample, path)).find((held) => held !== null);
    const base = holder?.sample ?? fallback;
    return {
      contract,
      path,
      kind: "refinement",
      detail,
      value: replaced(base.value, path, value),
      rule: { kind: "refinement", metLocations: holder?.locations ?? [] },
    };
  });
}

interface HeldMember {
  readonly sample: Sample;
  readonly locations: readonly SchemaLocation[];
}

function memberAt(sample: Sample, path: Path): HeldMember | null {
  const held = [...sample.knownValueSites, ...sample.sites].filter((site) =>
    samePath(site.path, path),
  );
  return held.length === 0 ? null : { sample, locations: held.map((site) => site.location) };
}

function samePath(left: Path, right: Path): boolean {
  return left.length === right.length && left.every((segment, index) => segment === right[index]);
}

// A node the text prints no note for has no entry.
function ownNotes(notes: NoteIndex, location: SchemaLocation): readonly string[] {
  const own = notes.get(locationKey(location));
  return own === undefined ? [] : own;
}

function memberStates(
  notes: NoteIndex,
  location: SchemaLocation,
  tokens: readonly string[],
): Verdict {
  if (tokens.length === 0) {
    return silent("no note states this rule");
  }
  const own = ownNotes(notes, location);
  if (own.length === 0) {
    return silent("the member prints no note");
  }
  const stated = tokens.every((token) => own.includes(token));
  return stated ? CAUGHT_BY_NOTE : silent("the note omits the rule");
}

// A refinement's message rides in its node's description, beside whatever else that says, so the
// node's own description note carries it rather than equalling it.
function refinementStates(
  mutation: Mutation,
  locations: readonly SchemaLocation[],
  notes: NoteIndex,
): Verdict {
  if (locations.length === 0) {
    return silent("no member at this path");
  }
  const messages = mutation.contract.refinedBy(mutation.value);
  if (messages.length === 0) {
    return silent("no note states this rule");
  }
  const own = locations.flatMap((location) => ownNotes(notes, location));
  if (own.length === 0) {
    return silent("the member prints no note");
  }
  const stated = messages.every((message) =>
    own.some((note) => note.includes(`${REFINED_PREFIX}${message}`)),
  );
  return stated ? CAUGHT_BY_NOTE : silent("the note omits the rule");
}

function branchTokens(branch: SchemaNode, type: string): string[] {
  if (type === "number") {
    return boundBreaks(branch).map(({ token }) => token);
  }
  if (type !== "string") {
    return [];
  }
  const pattern = branch.pattern === undefined ? null : patternToken(branch.pattern);
  return [lengthToken(branch), branch.format ?? null, pattern].filter((token) => token !== null);
}

function siblingBranchStates(mutation: Mutation, site: Site, notes: NoteIndex): Verdict {
  if (site.position.kind !== "alternative") {
    return silent("no note states this rule");
  }
  const type = jsonType(valueAt(mutation.value, site.path));
  const branch = site.position.siblings
    .flatMap(({ schema, location }) =>
      typeof schema === "boolean" ? [] : [{ node: schema, location }],
    )
    .find(({ node }) => valueTypes(statedTypes(node)).includes(type));
  if (branch === undefined) {
    return silent("no note states this rule");
  }
  return memberStates(notes, branch.location, branchTokens(branch.node, type));
}

function noteVerdict(mutation: Mutation, notes: NoteIndex): Verdict {
  const { rule } = mutation;
  switch (rule.kind) {
    case "member": {
      return memberStates(
        notes,
        rule.location,
        rule.statingNote === null ? [] : [rule.statingNote],
      );
    }
    case "branch": {
      return siblingBranchStates(mutation, rule.site, notes);
    }
    case "refinement": {
      return refinementStates(mutation, rule.metLocations, notes);
    }
  }
}

function commandKnownValue(path: Path): Json | null {
  const last = path.at(-1);
  if (last === "dataset_query") {
    return VALID_MBQL;
  }
  if (last === "document") {
    return VALID_DOCUMENT;
  }
  if (typeof last === "string" && last.endsWith(VERSION_SUFFIX)) {
    return VALID_VERSION;
  }
  return null;
}

function refinementMessages(schema: ZodType): (value: Json) => readonly string[] {
  return (value) => {
    const parsed = schema.safeParse(value);
    const issues = parsed.success ? [] : parsed.error.issues;
    return issues.filter((issue) => issue.code === "custom").map((issue) => issue.message);
  };
}

function acceptsUnchanged(schema: ZodType): (value: Json) => boolean {
  return (value) => {
    const parsed = schema.safeParse(value);
    return parsed.success && isDeepStrictEqual(parsed.data, value);
  };
}

async function commandContract(
  path: readonly string[],
  side: Side,
  schema: ZodType,
): Promise<Contract> {
  const root = Schema.parse(await schemaJson(path, side));
  const typeName = SIDES[side];
  return {
    name: `${path.join(" ")} ${side}`,
    family: "command",
    typeName,
    documents: new Map([["", root]]),
    entry: "",
    accepts:
      side === "input" ? (value) => schema.safeParse(value).success : acceptsUnchanged(schema),
    refinedBy: refinementMessages(schema),
    render: () => renderTypeScriptWithNotes(root, { name: typeName }),
    knownValueAt: commandKnownValue,
  };
}

async function commandContracts(): Promise<Contract[]> {
  const leaves = (await buildHelpIndex(main, [])).commands.map((entry) => entry.command.split(" "));
  const contracts: Contract[] = [];
  for (const path of leaves) {
    const augment = getMetabaseAugment(await resolveCommandPath(main, path));
    if (augment?.input?.kind === "zod") {
      contracts.push(await commandContract(path, "input", augment.input.schema));
    }
    if (augment?.outputSchema) {
      contracts.push(await commandContract(path, "output", augment.outputSchema));
    }
  }
  return contracts;
}

function mbqlContract(): Contract {
  const { schema, defs } = getQuerySchemaBundle();
  const entry = Schema.parse(schema);
  const parsedDefs = Object.entries(defs).map(([name, def]) => [name, Schema.parse(def)] as const);
  return {
    name: "query input",
    family: "mbql",
    typeName: SIDES.input,
    documents: new Map([[QUERY_SCHEMA_DOCUMENT, entry], ...parsedDefs]),
    entry: QUERY_SCHEMA_DOCUMENT,
    accepts: (value) => validateQuery(value).ok,
    refinedBy: () => [],
    render: () =>
      renderTypeScriptWithNotes(entry, {
        name: SIDES.input,
        documentName: QUERY_SCHEMA_DOCUMENT,
        documents: Object.fromEntries(parsedDefs),
      }),
    knownValueAt: () => null,
  };
}

function validSamples(contract: Contract): Sample[] {
  const attempts = contract.family === "mbql" ? MBQL_ATTEMPTS : COMMAND_ATTEMPTS;
  const seen = new Set<string>();
  const samples: Sample[] = [];
  for (let seed = 0; seed < attempts; seed++) {
    const sample = generateSample(contract, seed);
    const text = sample === null ? null : JSON.stringify(sample.value);
    if (sample === null || text === null || seen.has(text)) {
      continue;
    }
    seen.add(text);
    samples.push(sample);
  }
  return samples.filter((sample) => contract.accepts(sample.value));
}

function contractRun(contract: Contract): ContractRun {
  const samples = validSamples(contract);
  const refinements = refinementMutations(contract, samples);
  const mutations = [
    ...mutationsOf(contract, samples),
    ...refinements.filter((mutation) => !contract.accepts(mutation.value)),
  ];
  const rendered = contract.render();
  const lines = rendered.text.split("\n");
  const declare = (value: Json): number => {
    const line = lines.length + 1;
    lines.push(`export const v${line}: ${contract.typeName} = ${JSON.stringify(value)};`);
    return line;
  };
  return {
    contract,
    file: `/lossless/${contract.name.replaceAll(" ", "_")}.ts`,
    notes: indexNotes(rendered),
    samples: samples.map(({ value }) => ({ line: declare(value), value })),
    mutations: mutations.map((mutation) => ({
      line: declare(mutation.value),
      value: mutation.value,
      mutation,
    })),
    source: lines.join("\n"),
  };
}

function indexNotes({ notes }: RenderedTypeScript): NoteIndex {
  const index = new Map<string, string[]>();
  for (const { location, text } of notes) {
    const key = locationKey(location);
    const own = index.get(key);
    if (own === undefined) {
      index.set(key, [text]);
    } else {
      own.push(text);
    }
  }
  return index;
}

function lineOf(file: string | null, line: number | null): string {
  return `${file}:${line}`;
}

function preview(value: Json | undefined): string {
  return value === undefined ? "(absent)" : JSON.stringify(value).slice(0, PREVIEW_CHARS);
}

async function fuzz(): Promise<FuzzRun> {
  const runs = [...(await commandContracts()), mbqlContract()].map(contractRun);
  const diagnostics = compileTypeScript(new Map(runs.map((run) => [run.file, run.source])));
  const rejected = new Set(
    diagnostics.map((diagnostic) => lineOf(diagnostic.file, diagnostic.line)),
  );
  const probeLines = new Set(
    runs.flatMap((run) =>
      [...run.samples, ...run.mutations].map((probe) => lineOf(run.file, probe.line)),
    ),
  );
  const unplaced = diagnostics
    .filter((diagnostic) => !probeLines.has(lineOf(diagnostic.file, diagnostic.line)))
    .map((diagnostic) => ({
      where: lineOf(diagnostic.file, diagnostic.line),
      detail: diagnostic.message,
    }));
  const rejectedSamples = runs.flatMap((run) =>
    run.samples
      .filter((probe) => rejected.has(lineOf(run.file, probe.line)))
      .map((probe) => ({ where: run.contract.name, detail: preview(probe.value) })),
  );
  const judgements = runs.flatMap((run) =>
    run.mutations.map(({ line, mutation }) => ({
      mutation,
      verdict: rejected.has(lineOf(run.file, line))
        ? CAUGHT_BY_TYPE
        : noteVerdict(mutation, run.notes),
    })),
  );
  return {
    judgements,
    refined: runs
      .filter((run) => [...run.contract.documents.values()].some(carriesRefinement))
      .map((run) => run.contract.name)
      .toSorted(),
    typeCheckFailures: [...unplaced, ...rejectedSamples],
    unexercised: unexercised(runs),
  };
}

function carriesRefinement(schema: Schema): boolean {
  if (typeof schema === "boolean") {
    return false;
  }
  const refined = schema.description?.includes(REFINED_PREFIX) === true;
  return refined || subschemas(schema).some(carriesRefinement);
}

// The node schema leaves the conditional keywords unparsed, so each is parsed where it is walked.
function subschemas(node: SchemaNode): Schema[] {
  const maps = [node.$defs, node.properties].filter((map) => map !== undefined);
  const lists = [node.prefixItems, node.anyOf, node.oneOf, node.allOf, ...maps.map(Object.values)];
  const singles = [node.additionalProperties, node.propertyNames, node.items];
  const conditionals = CONDITIONAL_KEYWORDS.map((keyword) => node[keyword]);
  return [
    ...lists.filter((list) => list !== undefined).flat(),
    ...singles.filter((single) => single !== undefined),
    ...conditionals.filter((part) => part !== undefined).map((part) => Schema.parse(part)),
  ];
}

function unexercised(runs: readonly ContractRun[]): string[] {
  const byName = new Map(runs.map((run) => [run.contract.name, run]));
  const idle = runs
    .filter((run) => run.samples.length === 0)
    .map((run) => `${run.contract.name}: no valid sample`);
  const refinements = [...REFINEMENTS].flatMap(([name, declared]) => {
    const run = byName.get(name);
    if (run === undefined) {
      return [`${name}: no such contract`];
    }
    const kept = run.mutations.filter(({ mutation }) => mutation.kind === "refinement");
    return kept.length === declared.length
      ? []
      : [`${name}: the validator accepts a refinement break`];
  });
  return [...idle, ...refinements];
}

function silentRows(run: FuzzRun, family: Family): SilentRow[] {
  return run.judgements.flatMap(({ mutation, verdict }) => {
    if (verdict.kind !== "silent" || mutation.contract.family !== family) {
      return [];
    }
    return [
      {
        contract: mutation.contract.name,
        path: mutation.path.join("."),
        mutation: `${mutation.kind}: ${mutation.detail}`,
        value: preview(valueAt(mutation.value, mutation.path)),
        reason: verdict.reason,
      },
    ];
  });
}

const RUN = await fuzz();

describe("the TypeScript view of every contract", () => {
  it("exercises every contract and every declared refinement", () => {
    expect(RUN.unexercised).toEqual([]);
  });

  it("declares a refinement break for exactly the contracts whose schema carries a refinement", () => {
    expect(RUN.refined).toEqual([...REFINEMENTS.keys()].toSorted());
  });

  it("type-checks every value the validator accepts", () => {
    expect(RUN.typeCheckFailures).toEqual([]);
  });

  it("states every rule a command schema enforces, in its type or a note", () => {
    expect(silentRows(RUN, "command")).toEqual([]);
  });

  it("states every rule the MBQL schema enforces, in its type or a note", () => {
    expect(silentRows(RUN, "mbql")).toEqual([]);
  });
});
