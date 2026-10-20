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
import { compileTypeScript } from "./compile-typescript";
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
} from "./schema-samples";
import {
  isStatedBound,
  NOTE_SEPARATOR,
  renderTypeScript,
  Schema,
  type SchemaNode,
} from "./schema-ts";

type Family = "command" | "mbql";

interface Contract extends SampleSource {
  readonly name: string;
  readonly family: Family;
  readonly typeName: string;
  readonly accepts: (value: Json) => boolean;
  readonly render: () => string;
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
  readonly node: SchemaNode;
  readonly tokens: readonly string[];
}

interface BranchRule {
  readonly kind: "branch";
  readonly site: Site;
}

interface RefinementRule {
  readonly kind: "refinement";
  readonly node: SchemaNode | null;
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

interface ContractRun {
  readonly contract: Contract;
  readonly file: string;
  readonly source: string;
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

const MARK = "ZZMARK";
const NOTE_START = "//";
const NOTE_BOUNDARY = /; |, /;
// A member's own notes print just before its description; earlier ones on the line are a parent's.
const MEMBER_NOTE_WINDOW = 5;
const PREVIEW_CHARS = 200;
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

function lengthToken(node: SchemaNode): string {
  return node.minLength === 1 && node.maxLength === undefined ? "non-empty" : "chars";
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
  const { node } = site;
  const stating = (token: string): MemberRule => ({ kind: "member", node, tokens: [token] });
  const bounds = [
    { keyword: "minimum", bound: node.minimum, breach: (bound: number) => bound - 1 },
    { keyword: "exclusiveMinimum", bound: node.exclusiveMinimum, breach: (bound: number) => bound },
    { keyword: "maximum", bound: node.maximum, breach: (bound: number) => bound + 1 },
    { keyword: "exclusiveMaximum", bound: node.exclusiveMaximum, breach: (bound: number) => bound },
  ];
  const ranges = bounds.flatMap(({ keyword, bound, breach }) =>
    !isStatedBound(bound)
      ? []
      : [edit("out-of-range", `${keyword} ${bound}`, breach(bound), stating(String(bound)))],
  );
  const integral = site.types.includes("integer") && !site.types.includes("number");
  const fraction = here + NON_INTEGER_OFFSET;
  return integral ? [...ranges, edit("non-integer", "integer", fraction, stating("int"))] : ranges;
}

function stringBreaks(site: Site, here: Json): Edit[] {
  if (typeof here !== "string") {
    return [];
  }
  const { node } = site;
  const length: MemberRule = { kind: "member", node, tokens: [lengthToken(node)] };
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
    const rule: MemberRule = { kind: "member", node, tokens: [node.pattern] };
    edits.push(edit("pattern", `pattern /${node.pattern}/`, bad, rule));
  }
  return edits;
}

function arrayBreaks(site: Site, here: Json): Edit[] {
  if (!Array.isArray(here)) {
    return [];
  }
  const { node } = site;
  if (node.prefixItems !== undefined) {
    return tupleBreaks(node, node.prefixItems, here);
  }
  const [head] = here;
  if (head === undefined) {
    return [];
  }
  const count: MemberRule = { kind: "member", node, tokens: ["items"] };
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

function tupleBreaks(node: SchemaNode, prefix: readonly Schema[], here: readonly Json[]): Edit[] {
  const unstated: MemberRule = { kind: "member", node, tokens: [] };
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
  const { node } = site;
  const unstated: MemberRule = { kind: "member", node, tokens: [] };
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
    const tokens = typeof names !== "boolean" && names.pattern !== undefined ? [names.pattern] : [];
    edits.push(edit("bad-record-key", "propertyNames", renamed, { kind: "member", node, tokens }));
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
  const nodeIds = new Map<SchemaNode, number>();
  const idOf = (node: SchemaNode): number => {
    const known = nodeIds.get(node);
    if (known !== undefined) {
      return known;
    }
    nodeIds.set(node, nodeIds.size);
    return nodeIds.size - 1;
  };
  const done = new Set<string>();
  const mutations: Mutation[] = [];
  for (const sample of samples) {
    for (const site of sample.sites) {
      const here = valueAt(sample.value, site.path);
      if (here === undefined) {
        continue;
      }
      for (const { kind, detail, replacement, rule } of editsAt(site, here)) {
        const key = `${idOf(site.node)}|${kind}|${detail}|${tagOf(here)}`;
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
      rule: { kind: "refinement", node: holder === undefined ? null : holder.site.node },
    };
  });
}

interface HeldMember {
  readonly sample: Sample;
  readonly site: Site;
}

function memberAt(sample: Sample, path: Path): HeldMember | null {
  const site = [...sample.knownValueSites, ...sample.sites].find((held) =>
    samePath(held.path, path),
  );
  return site === undefined ? null : { sample, site };
}

function samePath(left: Path, right: Path): boolean {
  return left.length === right.length && left.every((segment, index) => segment === right[index]);
}

function renderMarked(contract: Contract, node: SchemaNode, marked: string): string {
  const { description } = node;
  node.description = marked;
  try {
    return contract.render();
  } finally {
    if (description === undefined) {
      delete node.description;
    } else {
      node.description = description;
    }
  }
}

function noteBeforeMark(line: string): string {
  const start = line.indexOf(NOTE_START);
  return start < 0 ? "" : line.slice(start, line.indexOf(MARK));
}

function memberStates(contract: Contract, node: SchemaNode, tokens: readonly string[]): Verdict {
  if (tokens.length === 0) {
    return silent("no note states this rule");
  }
  const lines = renderMarked(contract, node, MARK)
    .split("\n")
    .filter((line) => line.includes(MARK));
  if (lines.length === 0) {
    return silent("the member prints no note");
  }
  const stated = lines.some((line) => {
    const own = noteBeforeMark(line).split(NOTE_BOUNDARY).slice(-MEMBER_NOTE_WINDOW).join(" ");
    return tokens.some((token) => own.includes(token));
  });
  return stated ? CAUGHT_BY_NOTE : silent("the note omits the rule");
}

// A member's line carries its type's notes, then its own description, so whatever precedes the
// mark appended to that description is the member's note. A refinement message has its own commas,
// so the whole note counts, not the last few segments.
function refinementStates(contract: Contract, node: SchemaNode | null): Verdict {
  if (node === null) {
    return silent("no member at this path");
  }
  const { description } = node;
  const marked = description === undefined ? MARK : `${description}${NOTE_SEPARATOR}${MARK}`;
  const lines = renderMarked(contract, node, marked)
    .split("\n")
    .filter((line) => line.includes(MARK));
  if (lines.length === 0) {
    return silent("the member prints no note");
  }
  const stated = lines.some((line) => noteBeforeMark(line).includes(REFINED_PREFIX));
  return stated ? CAUGHT_BY_NOTE : silent("the note omits the rule");
}

function branchTokens(branch: SchemaNode, type: string): string[] {
  if (type === "number") {
    const bounds = [
      branch.minimum,
      branch.maximum,
      branch.exclusiveMinimum,
      branch.exclusiveMaximum,
    ];
    return bounds.filter(isStatedBound).map(String);
  }
  if (type === "string") {
    return [branch.pattern, lengthToken(branch), branch.format].filter(
      (note) => note !== undefined,
    );
  }
  return [];
}

function siblingBranchStates(mutation: Mutation, site: Site): Verdict {
  if (site.position.kind !== "alternative") {
    return silent("no note states this rule");
  }
  const type = jsonType(valueAt(mutation.value, site.path));
  const branch = site.position.siblings.find(
    (sibling): sibling is SchemaNode =>
      typeof sibling !== "boolean" && valueTypes(statedTypes(sibling)).includes(type),
  );
  if (branch === undefined) {
    return silent("no note states this rule");
  }
  return memberStates(mutation.contract, branch, branchTokens(branch, type));
}

function noteVerdict(mutation: Mutation): Verdict {
  const { rule } = mutation;
  switch (rule.kind) {
    case "member": {
      return memberStates(mutation.contract, rule.node, rule.tokens);
    }
    case "branch": {
      return siblingBranchStates(mutation, rule.site);
    }
    case "refinement": {
      return refinementStates(mutation.contract, rule.node);
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
    render: () => renderTypeScript(root, { name: typeName }),
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
    render: () =>
      renderTypeScript(entry, {
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
  const lines = contract.render().split("\n");
  const declare = (value: Json): number => {
    const line = lines.length + 1;
    lines.push(`export const v${line}: ${contract.typeName} = ${JSON.stringify(value)};`);
    return line;
  };
  return {
    contract,
    file: `/lossless/${contract.name.replaceAll(" ", "_")}.ts`,
    samples: samples.map(({ value }) => ({ line: declare(value), value })),
    mutations: mutations.map((mutation) => ({
      line: declare(mutation.value),
      value: mutation.value,
      mutation,
    })),
    source: lines.join("\n"),
  };
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
      verdict: rejected.has(lineOf(run.file, line)) ? CAUGHT_BY_TYPE : noteVerdict(mutation),
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
