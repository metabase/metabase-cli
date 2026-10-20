import type { z } from "zod";

import { Schema, type SchemaNode } from "./schema-ts";

export type Json = z.core.util.JSONType;

export interface JsonObject {
  [key: string]: Json;
}

export type Path = readonly (string | number)[];
export type TypeName = Extract<SchemaNode["type"], string>;

interface PlainPosition {
  readonly kind: "plain";
}

interface TupleHeadPosition {
  readonly kind: "tuple-head";
}

interface AlternativePosition {
  readonly kind: "alternative";
  readonly siblings: readonly Schema[];
}

type Position = PlainPosition | TupleHeadPosition | AlternativePosition;

// Where a generated value sits in the documents. `node` is the document node whose note the
// rendered member prints; `types` are the JSON types the value was generated against, which a
// type-test conditional narrows below what `node` declares.
export interface Site {
  readonly path: Path;
  readonly node: SchemaNode;
  readonly types: readonly TypeName[];
  readonly position: Position;
}

export interface Sample {
  readonly value: Json;
  readonly sites: readonly Site[];
  readonly knownValueSites: readonly Site[];
}

export interface SampleSource {
  readonly documents: ReadonlyMap<string, Schema>;
  readonly entry: string;
  readonly knownValueAt: (path: Path) => Json | null;
}

interface Where {
  readonly document: string;
  readonly position: Position;
  readonly forcedType: TypeName | null;
}

interface ResolvedRef {
  readonly document: string;
  readonly schema: Schema;
}

const DEPTH = {
  scalarAlternative: 10,
  scalarType: 8,
  tupleRest: 8,
  optionalProperty: 7,
  minimalArray: 6,
} as const;
// Zod bounds every number by about ±Number.MAX_VALUE or ±MAX_SAFE_INTEGER; neither is a rule.
const UNSTATED_BOUND = 1e15;
const NUMBER_SPAN = 50;
const DEFAULT_LOW = -5;
const SEED_MULTIPLIER = 2654435761;
const STATE_INCREMENT = 0x6d2b79f5;

const STRINGS = [
  "abc",
  "2024-01-01T00:00:00Z",
  "123e4567-e89b-42d3-a456-426614174000",
  "a@b.co",
  "12",
  "-12",
  "1:abc",
  "x",
];
const FORMATS: ReadonlyMap<string, string> = new Map([
  ["date-time", "2024-01-01T00:00:00Z"],
  ["date", "2024-01-01"],
  ["email", "a@b.co"],
  ["uuid", "123e4567-e89b-42d3-a456-426614174000"],
  ["uri", "https://example.com"],
]);
const FILLER = "abcdefghij".repeat(10);
const SHORTEST_FILLER = 3;
const RECORD_KEYS = ["-1", "1", "k1"];
const DEFAULT_RECORD_KEY = "k1";
const UNTYPED_STRING = "x";
const UNTYPED_NUMBER = 1;
const UNTYPED_OBJECT: Json = { k: 1 };
const SCALAR_TYPES: ReadonlySet<unknown> = new Set(["null", "string", "boolean"]);
const DEFS_FRAGMENT = "/$defs/";
const DISPATCH_MEMBER_KEYS = "if,then";

type ConditionalKeyword = "if" | "then" | "else";

class UnsatisfiableSchema extends Error {}

const validated = new WeakSet<object>();

// The renderer's node schema leaves `if`, `then` and `else` unparsed, so a walk checks each one
// where it reads it, in place: the generator hands back the very nodes the renderer will read.
function isSchema(value: unknown): value is Schema {
  if (typeof value === "boolean") {
    return true;
  }
  if (typeof value !== "object" || value === null) {
    return false;
  }
  if (validated.has(value)) {
    return true;
  }
  const valid = Schema.safeParse(value).success;
  if (valid) {
    validated.add(value);
  }
  return valid;
}

function conditionalPart(node: SchemaNode, keyword: ConditionalKeyword): Schema | null {
  const part = node[keyword];
  if (part === undefined) {
    return null;
  }
  if (!isSchema(part)) {
    throw new Error(`"${keyword}" holds no JSON Schema: ${JSON.stringify(part)}`);
  }
  return part;
}

export function isJsonObject(value: Json | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function declaredTypes(node: SchemaNode): readonly TypeName[] {
  if (node.type === undefined) {
    return [];
  }
  return typeof node.type === "string" ? [node.type] : node.type;
}

export function isStatedBound(bound: number | undefined): bound is number {
  return bound !== undefined && Math.abs(bound) < UNSTATED_BOUND;
}

export function generateSample(source: SampleSource, seed: number): Sample | null {
  try {
    return generateFrom(source, seed);
  } catch (error) {
    if (error instanceof UnsatisfiableSchema) {
      return null;
    }
    throw error;
  }
}

function first<T>(items: readonly T[]): T {
  const [head] = items;
  if (head === undefined) {
    throw new UnsatisfiableSchema();
  }
  return head;
}

function shallowTypes(declared: readonly TypeName[], depth: number): readonly TypeName[] {
  if (depth <= DEPTH.scalarType) {
    return declared;
  }
  return declared.filter((type) => type !== "array" && type !== "object");
}

function resolveRef(
  documents: ReadonlyMap<string, Schema>,
  ref: string,
  from: string,
): ResolvedRef {
  const hash = ref.indexOf("#");
  const named = hash === -1 ? ref : ref.slice(0, hash);
  const document = named === "" ? from : named;
  const root = documents.get(document);
  const fragment = hash === -1 ? "" : ref.slice(hash + 1);
  if (root === undefined) {
    throw new Error(`$ref "${ref}" names no document`);
  }
  if (fragment === "") {
    return { document, schema: root };
  }
  const schema =
    typeof root === "boolean" ? undefined : root.$defs?.[fragment.slice(DEFS_FRAGMENT.length)];
  if (!fragment.startsWith(DEFS_FRAGMENT) || schema === undefined) {
    throw new Error(`$ref "${ref}" points at no $defs entry`);
  }
  return { document, schema };
}

function isDispatch(members: readonly Schema[]): boolean {
  return (
    members.length > 0 &&
    members.every(
      (member) =>
        typeof member !== "boolean" &&
        Object.keys(member).toSorted().join() === DISPATCH_MEMBER_KEYS,
    )
  );
}

function plain(document: string): Where {
  return { document, position: { kind: "plain" }, forcedType: null };
}

function generateFrom(source: SampleSource, seed: number): Sample {
  let state = (seed * SEED_MULTIPLIER + 1) >>> 0;
  const sites: Site[] = [];
  const knownValueSites: Site[] = [];
  const entry = source.documents.get(source.entry);
  if (entry === undefined) {
    throw new Error(`no entry document ${source.entry}`);
  }
  return { value: generate(entry, plain(source.entry), 0, []), sites, knownValueSites };

  function rand(bound: number): number {
    state = (state + STATE_INCREMENT) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) % bound;
  }

  function coin(): boolean {
    return rand(2) === 1;
  }

  function pick<T>(items: readonly T[]): T {
    if (items.length === 0) {
      throw new UnsatisfiableSchema();
    }
    return first(items.slice(rand(items.length)));
  }

  function record(path: Path, node: SchemaNode, where: Where): void {
    const types = where.forcedType === null ? declaredTypes(node) : [where.forcedType];
    sites.push({ path, node, types, position: where.position });
  }

  function generate(schema: Schema, where: Where, depth: number, path: Path): Json {
    const fixed = source.knownValueAt(path);
    if (fixed !== null) {
      if (typeof schema !== "boolean") {
        knownValueSites.push({
          path,
          node: schema,
          types: declaredTypes(schema),
          position: where.position,
        });
      }
      return structuredClone(fixed);
    }
    if (schema === true) {
      return coin() ? UNTYPED_NUMBER : UNTYPED_STRING;
    }
    if (schema === false) {
      throw new UnsatisfiableSchema();
    }
    const node = schema;
    if (node.$ref !== undefined) {
      const target = resolveRef(source.documents, node.$ref, where.document);
      return generate(target.schema, plain(target.document), depth, path);
    }
    if (node.const !== undefined) {
      record(path, node, where);
      return node.const;
    }
    if (node.enum !== undefined) {
      record(path, node, where);
      return pick(node.enum);
    }
    const alternatives = node.anyOf ?? node.oneOf;
    if (alternatives !== undefined) {
      return generateAlternative(alternatives, where, depth, path);
    }
    const test = conditionalPart(node, "if");
    if (test !== null && typeof test !== "boolean" && test.type !== undefined) {
      return generateTypeTest(node, test.type, where, depth, path);
    }
    if (node.allOf !== undefined) {
      return generateAllOf(node, node.allOf, where, depth, path);
    }
    return generateTyped(node, pickType(node, where, depth), where, depth, path);
  }

  function generateAlternative(
    alternatives: readonly Schema[],
    where: Where,
    depth: number,
    path: Path,
  ): Json {
    const scalar = alternatives.find(
      (branch) => typeof branch !== "boolean" && SCALAR_TYPES.has(branch.type),
    );
    const deep = depth > DEPTH.scalarAlternative && scalar !== undefined;
    const branch = deep ? scalar : pick(alternatives);
    const position: AlternativePosition = { kind: "alternative", siblings: alternatives };
    return generate(branch, { ...plain(where.document), position }, depth, path);
  }

  function generateTypeTest(
    node: SchemaNode,
    tested: SchemaNode["type"],
    where: Where,
    depth: number,
    path: Path,
  ): Json {
    const declared = declaredTypes(node);
    const consequent = conditionalPart(node, "then") ?? true;
    const otherwise = conditionalPart(node, "else");
    const inner = plain(where.document);
    if (declared.length === 0) {
      const alternative = otherwise !== null && coin() ? otherwise : consequent;
      return generate(alternative, inner, depth, path);
    }
    const shallow = shallowTypes(declared, depth);
    const type = shallow.length === 0 ? null : pick(shallow);
    if (type !== null && type === tested) {
      const narrowed = typeof consequent === "boolean" ? node : consequent;
      return generate(narrowed, { ...inner, forcedType: type }, depth, path);
    }
    if (otherwise !== null) {
      return generate(otherwise, inner, depth, path);
    }
    return generateTyped(node, type, where, depth, path);
  }

  function generateAllOf(
    node: SchemaNode,
    members: readonly Schema[],
    where: Where,
    depth: number,
    path: Path,
  ): Json {
    if (isDispatch(members)) {
      return generateDispatch(node, members, where, depth, path);
    }
    const inner = plain(where.document);
    const parts = members.map((member) => generate(member, inner, depth, path));
    const typed = where.forcedType !== null || node.type !== undefined || node.properties;
    const base = typed
      ? [generateTyped(node, pickType(node, where, depth), where, depth, path)]
      : [];
    const all = [...base, ...parts];
    if (all.every(isJsonObject)) {
      const merged: JsonObject = {};
      for (const part of all) {
        Object.assign(merged, part);
      }
      return merged;
    }
    return first(all);
  }

  function generateDispatch(
    node: SchemaNode,
    members: readonly Schema[],
    where: Where,
    depth: number,
    path: Path,
  ): Json {
    const member = pick(members);
    if (typeof member === "boolean") {
      throw new UnsatisfiableSchema();
    }
    const inner = plain(where.document);
    const shape = conditionalPart(member, "then") ?? true;
    const test = conditionalPart(member, "if");
    const tagged = typeof test === "boolean" ? undefined : test?.properties;
    if (tagged === undefined) {
      const value = generate(shape, inner, depth, path);
      if (where.forcedType !== null || node.type !== undefined || node.minItems !== undefined) {
        record(path, node, where);
      }
      return value;
    }
    const [key, tagSchema] = first(Object.entries(tagged));
    if (typeof tagSchema === "boolean") {
      throw new UnsatisfiableSchema();
    }
    const tag = tagSchema.const ?? pick(tagSchema.enum ?? []);
    const base = node.properties === undefined ? {} : generateObject(node, where, depth, path);
    const shaped = generate(shape, inner, depth, path);
    record(path, node, where);
    return { ...base, ...(isJsonObject(shaped) ? shaped : {}), [key]: tag };
  }

  function pickType(node: SchemaNode, where: Where, depth: number): TypeName | null {
    if (where.forcedType !== null) {
      return where.forcedType;
    }
    const declared = declaredTypes(node);
    if (declared.length > 0) {
      const shallow = shallowTypes(declared, depth);
      return pick(shallow.length > 0 ? shallow : declared);
    }
    if (node.properties || node.additionalProperties !== undefined || node.propertyNames) {
      return "object";
    }
    if (node.items !== undefined || node.prefixItems) {
      return "array";
    }
    return null;
  }

  function generateTyped(
    node: SchemaNode,
    type: TypeName | null,
    where: Where,
    depth: number,
    path: Path,
  ): Json {
    if (type === null) {
      return coin() ? UNTYPED_OBJECT : UNTYPED_STRING;
    }
    record(path, node, where);
    switch (type) {
      case "null": {
        return null;
      }
      case "boolean": {
        return coin();
      }
      case "integer":
      case "number": {
        return generateNumber(node);
      }
      case "string": {
        return generateString(node);
      }
      case "array": {
        return generateArray(node, where, depth, path);
      }
      case "object": {
        return generateObject(node, where, depth, path);
      }
    }
  }

  function generateNumber(node: SchemaNode): number {
    const minimum = isStatedBound(node.minimum) ? node.minimum : DEFAULT_LOW;
    const low = node.exclusiveMinimum === undefined ? minimum : node.exclusiveMinimum + 1;
    const exclusiveHigh =
      node.exclusiveMaximum === undefined ? low + NUMBER_SPAN : node.exclusiveMaximum - 1;
    const high = isStatedBound(node.maximum) ? node.maximum : exclusiveHigh;
    const span = Math.max(1, Math.min(NUMBER_SPAN, high - low + 1));
    return Math.round(Math.max(low, Math.min(high, low + rand(span))));
  }

  function generateString(node: SchemaNode): string {
    const formatted = node.format === undefined ? undefined : FORMATS.get(node.format);
    if (formatted !== undefined) {
      return formatted;
    }
    const pattern = node.pattern === undefined ? null : new RegExp(node.pattern, "u");
    const min = node.minLength ?? 0;
    const max = node.maxLength ?? Infinity;
    const fits = STRINGS.find(
      (text) =>
        text.length >= min && text.length <= max && (pattern === null || pattern.test(text)),
    );
    return fits ?? FILLER.slice(0, Math.min(max, Math.max(min, SHORTEST_FILLER)));
  }

  function generateArray(node: SchemaNode, where: Where, depth: number, path: Path): Json {
    const inner = plain(where.document);
    const maxItems = node.maxItems ?? Infinity;
    if (node.prefixItems !== undefined) {
      const fixed = node.prefixItems.slice(0, maxItems);
      const items = fixed.map((element, index) => {
        const position: Position = index === 0 ? { kind: "tuple-head" } : { kind: "plain" };
        return generate(element, { ...inner, position }, depth + 1, [...path, index]);
      });
      const rest = node.items;
      const open = rest !== undefined && rest !== false && items.length < maxItems;
      if (open && depth < DEPTH.tupleRest && coin()) {
        items.push(generate(rest, inner, depth + 1, [...path, items.length]));
      }
      return items;
    }
    const min = node.minItems ?? 0;
    const wanted = depth > DEPTH.minimalArray ? min : Math.max(min, 1 + rand(2));
    const element = node.items ?? true;
    return Array.from({ length: Math.min(wanted, maxItems) }, (_, index) =>
      generate(element, inner, depth + 1, [...path, index]),
    );
  }

  function generateObject(node: SchemaNode, where: Where, depth: number, path: Path): JsonObject {
    const inner = plain(where.document);
    const out: JsonObject = {};
    const required = new Set(node.required ?? []);
    const properties = Object.entries(node.properties ?? {});
    for (const [key, property] of properties) {
      if (required.has(key) || (depth < DEPTH.optionalProperty && coin())) {
        out[key] = generate(property, inner, depth + 1, [...path, key]);
      }
    }
    const [firstProperty] = properties;
    if (firstProperty !== undefined && Object.keys(out).length === 0 && depth === 0) {
      const [key, property] = firstProperty;
      out[key] = generate(property, inner, depth + 1, [...path, key]);
    }
    const extra = node.additionalProperties;
    if (properties.length > 0 || extra === undefined || extra === false) {
      return out;
    }
    const keys = recordKeys(propertyNamesOf(node, where));
    const missing = [...required].filter((key) => !keys.includes(key));
    for (const key of [...keys, ...missing]) {
      out[key] = generate(extra, inner, depth + 1, [...path, key]);
    }
    return out;
  }

  function propertyNamesOf(node: SchemaNode, where: Where): SchemaNode | null {
    const names = node.propertyNames;
    if (names === undefined || typeof names === "boolean") {
      return null;
    }
    if (names.$ref === undefined) {
      return names;
    }
    const target = resolveRef(source.documents, names.$ref, where.document).schema;
    return typeof target === "boolean" ? null : target;
  }

  function recordKeys(names: SchemaNode | null): string[] {
    if (names?.enum !== undefined) {
      return names.enum.filter((key) => typeof key === "string").filter(() => rand(3) === 0);
    }
    if (names?.pattern !== undefined) {
      const pattern = new RegExp(names.pattern, "u");
      return RECORD_KEYS.filter((key) => pattern.test(key)).slice(0, 1);
    }
    return [DEFAULT_RECORD_KEY];
  }
}
