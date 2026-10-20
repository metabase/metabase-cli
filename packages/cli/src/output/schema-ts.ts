import { z } from "zod";

const TypeName = z.enum(["object", "array", "string", "number", "integer", "boolean", "null"]);
type TypeName = z.infer<typeof TypeName>;

const Literal = z.union([z.string(), z.number(), z.boolean(), z.null()]);
type Literal = z.infer<typeof Literal>;

const SchemaNode = z.looseObject({
  $ref: z.string().optional(),
  get $defs() {
    return z.record(z.string(), z.union([z.boolean(), SchemaNode])).optional();
  },
  type: z.union([TypeName, z.array(TypeName)]).optional(),
  const: Literal.optional(),
  enum: z.array(Literal).optional(),
  get properties() {
    return z.record(z.string(), z.union([z.boolean(), SchemaNode])).optional();
  },
  required: z.array(z.string()).optional(),
  get additionalProperties() {
    return z.union([z.boolean(), SchemaNode]).optional();
  },
  get propertyNames() {
    return z.union([z.boolean(), SchemaNode]).optional();
  },
  get items() {
    return z.union([z.boolean(), SchemaNode]).optional();
  },
  get prefixItems() {
    return z.array(z.union([z.boolean(), SchemaNode])).optional();
  },
  get anyOf() {
    return z.array(z.union([z.boolean(), SchemaNode])).optional();
  },
  get oneOf() {
    return z.array(z.union([z.boolean(), SchemaNode])).optional();
  },
  get allOf() {
    return z.array(z.union([z.boolean(), SchemaNode])).optional();
  },
  minimum: z.number().optional(),
  exclusiveMinimum: z.number().optional(),
  maximum: z.number().optional(),
  exclusiveMaximum: z.number().optional(),
  minLength: z.number().optional(),
  maxLength: z.number().optional(),
  minItems: z.number().optional(),
  maxItems: z.number().optional(),
  pattern: z.string().optional(),
  format: z.string().optional(),
  description: z.string().optional(),
  default: z.unknown().optional(),
});
type SchemaNode = z.infer<typeof SchemaNode>;

const Schema = z.union([z.boolean(), SchemaNode]);
type Schema = z.infer<typeof Schema>;

// The conditional keywords stay out of the parsed shape, where a `then` member would make every
// parsed node a thenable; `readConditional` parses them where they are read.
const CONDITIONAL_KEYWORDS = ["if", "then", "else"];

const HANDLED: ReadonlySet<string> = new Set([
  ...Object.keys(SchemaNode.shape),
  ...CONDITIONAL_KEYWORDS,
]);

// Each of these is an annotation or an assertion that only ever rejects values, so leaving it out
// of the rendered type widens what the type admits and never refuses a value the schema accepts.
const IGNORED: ReadonlySet<string> = new Set([
  "$schema",
  "$comment",
  "title",
  "examples",
  "deprecated",
  "readOnly",
  "writeOnly",
  "contentEncoding",
  "contentMediaType",
  "contentSchema",
  "not",
  "multipleOf",
  "uniqueItems",
  "contains",
  "minContains",
  "maxContains",
  "minProperties",
  "maxProperties",
  "dependentRequired",
  "dependentSchemas",
  "unevaluatedItems",
  "unevaluatedProperties",
]);

interface TsName {
  readonly kind: "name";
  readonly text: string;
}

interface TsArray {
  readonly kind: "array";
  readonly element: TsType;
}

interface TsTupleElement {
  readonly type: TsType;
  readonly optional: boolean;
}

interface TsTuple {
  readonly kind: "tuple";
  readonly elements: readonly TsTupleElement[];
  readonly rest: TsType | null;
}

interface TsMember {
  readonly key: string;
  readonly optional: boolean;
  readonly type: TsType;
  readonly notes: readonly string[];
}

interface TsObject {
  readonly kind: "object";
  readonly members: readonly TsMember[];
}

interface TsRecord {
  readonly kind: "record";
  readonly key: TsType;
  readonly value: TsType;
  readonly partial: boolean;
}

interface TsUnion {
  readonly kind: "union";
  readonly members: readonly TsType[];
}

interface TsIntersection {
  readonly kind: "intersection";
  readonly parts: readonly TsType[];
}

type TsType = TsName | TsArray | TsTuple | TsObject | TsRecord | TsUnion | TsIntersection;

interface Typed {
  readonly type: TsType;
  readonly notes: readonly string[];
}

const UNKNOWN: TsName = { kind: "name", text: "unknown" };
const NEVER: TsName = { kind: "name", text: "never" };
const STRING: TsName = { kind: "name", text: "string" };
const NUMBER: TsName = { kind: "name", text: "number" };
const BOOLEAN: TsName = { kind: "name", text: "boolean" };
const NULL: TsName = { kind: "name", text: "null" };

const UNTYPED: Typed = { type: UNKNOWN, notes: [] };

// Zod bounds every integer by ±Number.MAX_SAFE_INTEGER, which says nothing a reader needs.
const SAFE_INTEGER_BOUND = Number.MAX_SAFE_INTEGER;
const ONE_LINE_OBJECT_MAX = 100;
const ONE_LINE_UNION_MAX = 90;
const NOTE_SEPARATOR = "; ";
const NESTED_NOTE_SEPARATOR = ", ";
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const DEFS_POINTER = "/$defs/";
// Zod names a schema it extracts only because it is reused `__schema<N>`; the name means nothing.
const UNNAMED_DEF = /^__schema(\d+)$/;
const PROMOTED_PREFIX = "Schema";
const ENTRY_DOCUMENT = "";
const DISPATCH_MEMBER_KEYWORDS = ["if", "then"];
const OPEN_OBJECTS_HEADER = "// Objects accept keys beyond the ones listed.";

interface RenderOptions {
  readonly name: string;
  readonly strict?: boolean;
  readonly documentName?: string;
  readonly documents?: Readonly<Record<string, unknown>>;
}

interface Document {
  readonly key: string;
  readonly root: Schema;
}

interface ResolvedRef {
  readonly document: Document;
  readonly name: string | null;
  readonly schema: Schema;
}

interface TupleSlot {
  readonly kind: "tuple";
}

interface PropertySlot {
  readonly kind: "property";
  readonly key: string;
}

type TagSlot = TupleSlot | PropertySlot;

interface Conditional {
  readonly test: Schema;
  readonly consequent: Schema | null;
  readonly alternative: Schema | null;
}

interface DispatchBranch {
  readonly slot: TagSlot;
  readonly tag: readonly Literal[];
  readonly shape: Schema;
}

export function renderTypeScript(input: unknown, options: RenderOptions): string {
  const strict = options.strict === true;
  const entryKey = options.documentName ?? ENTRY_DOCUMENT;
  const entry: Document = { key: entryKey, root: Schema.parse(input) };
  const documents = new Map(
    [...parseDocuments(options.documents), entry].map((document) => [document.key, document]),
  );
  const aliasOwners = new Map<string, string>([[options.name, `${entryKey}#`]]);
  const declarations: string[] = [];
  const inlining = new Set<string>();
  const recursive = new Set<string>();
  let sawOpenObject = false;

  const root = convert(entry.root, entry);
  declarations.push(declaration(options.name, root));
  const header = sawOpenObject ? [OPEN_OBJECTS_HEADER] : [];
  return [...header, ...declarations].join("\n");

  function documentFor(name: string, from: Document): Document {
    if (name === ENTRY_DOCUMENT) {
      return from;
    }
    const known = documents.get(name);
    if (known === undefined) {
      throw new Error(`$ref names an unknown document "${name}"`);
    }
    return known;
  }

  function resolve(ref: string, from: Document): ResolvedRef {
    const hash = ref.indexOf("#");
    const fragment = ref.slice(hash + 1);
    if (hash === -1 || (fragment !== "" && !fragment.startsWith(DEFS_POINTER))) {
      throw new Error(`unsupported $ref "${ref}"`);
    }
    const document = documentFor(ref.slice(0, hash), from);
    if (fragment === "") {
      return { document, name: null, schema: document.root };
    }
    const pointer = fragment.slice(DEFS_POINTER.length);
    const name = pointer.replaceAll("~1", "/").replaceAll("~0", "~");
    const defs = typeof document.root === "boolean" ? undefined : document.root.$defs;
    const target = defs?.[name];
    if (target === undefined) {
      throw new Error(`$ref "${ref}" points at no $defs entry`);
    }
    return { document, name, schema: target };
  }

  function convertRef(ref: string, from: Document): Typed {
    const resolved = resolve(ref, from);
    if (resolved.name === null) {
      if (resolved.document !== entry) {
        throw new Error(`$ref "${ref}" names a whole document`);
      }
      return aliasReference(options.name);
    }
    const id = `${resolved.document.key}#${resolved.name}`;
    const unnamed = UNNAMED_DEF.exec(resolved.name);
    if (unnamed !== null) {
      return convertUnnamed(`${PROMOTED_PREFIX}${unnamed[1]}`, id, resolved);
    }
    if (claimName(resolved.name, id)) {
      declarations.push(declaration(resolved.name, convert(resolved.schema, resolved.document)));
    }
    return aliasReference(resolved.name);
  }

  // An unnamed schema is inlined at each use, unless it reaches itself: then it needs a name to
  // refer to, so it becomes an alias after all.
  function convertUnnamed(name: string, id: string, resolved: ResolvedRef): Typed {
    if (aliasOwners.get(name) === id) {
      return aliasReference(name);
    }
    if (inlining.has(id)) {
      recursive.add(id);
      return aliasReference(name);
    }
    inlining.add(id);
    const inlined = convert(resolved.schema, resolved.document);
    inlining.delete(id);
    if (!recursive.has(id)) {
      return inlined;
    }
    claimName(name, id);
    declarations.push(declaration(name, inlined));
    return aliasReference(name);
  }

  function claimName(name: string, id: string): boolean {
    const owner = aliasOwners.get(name);
    if (owner === id) {
      return false;
    }
    if (owner !== undefined) {
      throw new Error(`two schemas are both named "${name}"`);
    }
    if (!IDENTIFIER.test(name)) {
      throw new Error(`schema name "${name}" is not a TypeScript identifier`);
    }
    aliasOwners.set(name, id);
    return true;
  }

  function convert(schema: Schema, document: Document): Typed {
    if (schema === true) {
      return UNTYPED;
    }
    if (schema === false) {
      return { type: NEVER, notes: [] };
    }
    checkKeywords(schema);
    const core = convertCore(schema, document);
    return { type: core.type, notes: [...core.notes, ...annotationNotes(schema)] };
  }

  function checkKeywords(node: SchemaNode): void {
    if (!strict) {
      return;
    }
    for (const keyword of Object.keys(node)) {
      if (!HANDLED.has(keyword) && !IGNORED.has(keyword)) {
        throw new Error(`unsupported JSON Schema keyword "${keyword}"`);
      }
    }
  }

  function convertCore(node: SchemaNode, document: Document): Typed {
    if (node.const !== undefined) {
      return { type: literal(node.const), notes: [] };
    }
    if (node.enum !== undefined) {
      return { type: unionOf(node.enum.map(literal)), notes: [] };
    }
    const conditional = readConditional(node);
    const tested = conditional === null ? null : readTypeTest(conditional.test);
    if (conditional !== null && tested === null && strict) {
      throw new Error(
        `unsupported "if" outside an allOf dispatch: ${JSON.stringify(conditional.test)}`,
      );
    }
    const base =
      conditional === null || tested === null
        ? convertBase(node, declaredTypes(node), document)
        : convertTypeTest(node, conditional, tested, document);
    const composites = [
      ...(node.$ref === undefined ? [] : [convertRef(node.$ref, document)]),
      ...convertAlternatives(node, document),
      ...(node.allOf === undefined ? [] : [convertAllOf(node, node.allOf, document)]),
    ];
    return combine(base, composites);
  }

  function convertAlternatives(node: SchemaNode, document: Document): Typed[] {
    const alternatives = [node.anyOf, node.oneOf].filter((list) => list !== undefined);
    return alternatives.map((list) => unionTyped(list.map((branch) => convert(branch, document))));
  }

  function convertBase(
    node: SchemaNode,
    types: readonly TypeName[],
    document: Document,
  ): Typed | null {
    if (types.length === 0) {
      return null;
    }
    return unionTyped(types.map((type) => convertTyped(node, type, document)));
  }

  function convertTypeTest(
    node: SchemaNode,
    conditional: Conditional,
    tested: TypeName,
    document: Document,
  ): Typed | null {
    if (conditional.consequent === null) {
      return convertBase(node, declaredTypes(node), document);
    }
    const consequent = convert(narrow(conditional.consequent, tested), document);
    if (conditional.alternative !== null) {
      return unionTyped([consequent, convert(conditional.alternative, document)]);
    }
    if (node.type === undefined) {
      return UNTYPED;
    }
    const declared = declaredTypes(node);
    const others = declared.filter((type) => type !== tested);
    const branches = others.map((type) => convertTyped(node, type, document));
    return unionTyped(declared.includes(tested) ? [...branches, consequent] : branches);
  }

  function convertAllOf(node: SchemaNode, members: readonly Schema[], document: Document): Typed {
    const dispatch = readDispatch(members);
    if (dispatch === null) {
      return intersectionTyped(members.map((member) => convert(member, document)));
    }
    const branches = dispatch.map((branch) => convertBranch(branch, document));
    const fallback = fallbackBranch(node, dispatch);
    return unionTyped(fallback === null ? branches : [...branches, fallback]);
  }

  function convertBranch(branch: DispatchBranch, document: Document): Typed {
    const { slot, shape } = branch;
    if (slot.kind === "tuple" || typeof shape === "boolean" || shape.$ref !== undefined) {
      return convert(shape, document);
    }
    const tagged: SchemaNode = {
      ...shape,
      type: "object",
      properties: { [slot.key]: { enum: [...branch.tag] }, ...shape.properties },
      required: [slot.key, ...(shape.required ?? [])],
    };
    return convert(tagged, document);
  }

  function convertTyped(node: SchemaNode, type: TypeName, document: Document): Typed {
    switch (type) {
      case "string": {
        return { type: STRING, notes: stringNotes(node) };
      }
      case "number": {
        return { type: NUMBER, notes: rangeNotes(node) };
      }
      case "integer": {
        return { type: NUMBER, notes: ["int", ...rangeNotes(node)] };
      }
      case "boolean": {
        return { type: BOOLEAN, notes: [] };
      }
      case "null": {
        return { type: NULL, notes: [] };
      }
      case "array": {
        return convertArray(node, document);
      }
      case "object": {
        return convertObject(node, document);
      }
    }
  }

  function convertArray(node: SchemaNode, document: Document): Typed {
    if (node.prefixItems !== undefined) {
      return convertTuple(node, node.prefixItems, document);
    }
    const element = node.items === undefined ? UNTYPED : convert(node.items, document);
    return {
      type: { kind: "array", element: element.type },
      notes: [
        ...countNotes(node.minItems, node.maxItems, "items"),
        ...nestedNotes("items", element.notes),
      ],
    };
  }

  // A tuple spells its length bounds out: a bounded rest becomes optional elements, a required one
  // repeats the rest type, so no length constraint is left over for a comment. Zod writes minItems
  // only for an optional element and none for a defaulted one, so without minItems every prefix
  // element is required except a trailing run whose defaults fill it in.
  function convertTuple(node: SchemaNode, prefix: readonly Schema[], document: Document): Typed {
    const fixed = prefix.map((element) => convert(element, document).type);
    const required = node.minItems ?? defaultedTailStart(prefix);
    const rest =
      node.items === undefined || node.items === false ? null : convert(node.items, document).type;
    if (rest === null) {
      return { type: tupleOf(fixed, required, null), notes: [] };
    }
    const spelled = Math.max(fixed.length, node.maxItems ?? required);
    const types = [...fixed, ...Array.from({ length: spelled - fixed.length }, () => rest)];
    return { type: tupleOf(types, required, node.maxItems === undefined ? rest : null), notes: [] };
  }

  function convertObject(node: SchemaNode, document: Document): Typed {
    const members = convertMembers(node, document);
    const extra =
      node.additionalProperties === undefined
        ? UNTYPED
        : convert(node.additionalProperties, document);
    if (members.length > 0) {
      return objectWithExtra({ kind: "object", members }, extra);
    }
    if (extra.type === NEVER) {
      return { type: record(STRING, NEVER, false), notes: [] };
    }
    return {
      type: convertRecord(node, extra.type, document),
      notes: nestedNotes("values", extra.notes),
    };
  }

  function convertMembers(node: SchemaNode, document: Document): TsMember[] {
    if (node.properties === undefined) {
      return [];
    }
    const required = new Set(node.required);
    return Object.entries(node.properties).map(([key, property]) => {
      const typed = convert(property, document);
      return { key, optional: !required.has(key), type: typed.type, notes: typed.notes };
    });
  }

  // TypeScript cannot say "these members, and any other key of type V" without forcing V to admit
  // every member's type too, so a typed catchall is stated in the comment instead.
  function objectWithExtra(object: TsObject, extra: Typed): Typed {
    if (extra.type === NEVER) {
      return { type: object, notes: [] };
    }
    if (extra.type === UNKNOWN) {
      sawOpenObject = true;
      return { type: object, notes: [] };
    }
    return { type: object, notes: [`other keys: ${singleLine(print(extra.type))}`] };
  }

  function convertRecord(node: SchemaNode, value: TsType, document: Document): TsRecord {
    if (node.propertyNames === undefined) {
      return record(STRING, value, false);
    }
    const keys = convert(node.propertyNames, document).type;
    const listed = literalValues(node.propertyNames);
    const required = new Set(node.required);
    const exhaustive = listed === null || listed.every((key) => required.has(String(key)));
    return record(keys, value, !exhaustive);
  }
}

function parseDocuments(raw: Readonly<Record<string, unknown>> | undefined): Document[] {
  if (raw === undefined) {
    return [];
  }
  return Object.entries(raw).map(([key, schema]) => ({ key, root: Schema.parse(schema) }));
}

function combine(base: Typed | null, composites: readonly Typed[]): Typed {
  if (composites.length === 0) {
    return base === null ? UNTYPED : base;
  }
  const composite = intersectionTyped(composites);
  if (base === null) {
    return composite;
  }
  if (composite.type === UNKNOWN) {
    return base;
  }
  return isBare(base.type) ? composite : intersectionTyped([base, composite]);
}

function declaredTypes(node: SchemaNode): readonly TypeName[] {
  if (Array.isArray(node.type)) {
    return node.type;
  }
  if (node.type !== undefined) {
    return [node.type];
  }
  const objectLike = [node.properties, node.additionalProperties, node.propertyNames].some(
    (keyword) => keyword !== undefined,
  );
  const arrayLike = node.items !== undefined || node.prefixItems !== undefined;
  return [...(objectLike ? (["object"] as const) : []), ...(arrayLike ? (["array"] as const) : [])];
}

// A bare type adds nothing next to an allOf, anyOf, or $ref that already spells the shape out.
function isBare(type: TsType): boolean {
  switch (type.kind) {
    case "name": {
      return [UNKNOWN, STRING, NUMBER, BOOLEAN, NULL].includes(type);
    }
    case "array": {
      return type.element === UNKNOWN;
    }
    case "record": {
      return type.key === STRING && type.value === UNKNOWN;
    }
    case "union": {
      return type.members.every(isBare);
    }
    default: {
      return false;
    }
  }
}

function narrow(schema: Schema, type: TypeName): Schema {
  if (typeof schema === "boolean" || declaredTypes(schema).length > 0) {
    return schema;
  }
  return { ...schema, type };
}

function readConditional(node: SchemaNode): Conditional | null {
  const test = node["if"];
  if (test === undefined) {
    return null;
  }
  return {
    test: Schema.parse(test),
    consequent: parseOptionalSchema(node["then"]),
    alternative: parseOptionalSchema(node["else"]),
  };
}

function parseOptionalSchema(value: unknown): Schema | null {
  return value === undefined ? null : Schema.parse(value);
}

function readTypeTest(test: Schema): TypeName | null {
  const type = singleKeyword(test)?.type;
  return typeof type === "string" ? type : null;
}

// MBQL dispatches a clause on its tag: an allOf of `if <tag is X> then <shape of X>`, one per tag.
function readDispatch(members: readonly Schema[]): DispatchBranch[] | null {
  const branches = members.map(readBranch);
  const [first] = branches;
  if (first === undefined || first === null) {
    return null;
  }
  const uniform = branches.every(
    (branch): branch is DispatchBranch => branch !== null && sameSlot(branch.slot, first.slot),
  );
  return uniform ? branches : null;
}

function readBranch(member: Schema): DispatchBranch | null {
  if (typeof member === "boolean" || !hasExactKeywords(member, DISPATCH_MEMBER_KEYWORDS)) {
    return null;
  }
  const conditional = readConditional(member);
  const test = conditional === null ? null : singleKeyword(conditional.test);
  if (conditional === null || conditional.consequent === null || test === null) {
    return null;
  }
  const shape = conditional.consequent;
  if (test.prefixItems !== undefined) {
    const [head, ...others] = test.prefixItems;
    const tag = head === undefined || others.length > 0 ? null : literalValues(head);
    return tag === null ? null : { slot: { kind: "tuple" }, tag, shape };
  }
  if (test.properties === undefined) {
    return null;
  }
  const [entry, ...others] = Object.entries(test.properties);
  const tag = entry === undefined || others.length > 0 ? null : literalValues(entry[1]);
  return entry === undefined || tag === null
    ? null
    : { slot: { kind: "property", key: entry[0] }, tag, shape };
}

function singleKeyword(schema: Schema): SchemaNode | null {
  if (typeof schema === "boolean") {
    return null;
  }
  const [only, ...others] = Object.keys(schema);
  return only === undefined || others.length > 0 ? null : schema;
}

function hasExactKeywords(node: SchemaNode, keywords: readonly string[]): boolean {
  const present = Object.keys(node);
  return present.length === keywords.length && keywords.every((keyword) => keyword in node);
}

function literalValues(schema: Schema): readonly Literal[] | null {
  if (typeof schema === "boolean") {
    return null;
  }
  if (schema.const !== undefined) {
    return [schema.const];
  }
  return schema.enum ?? null;
}

function sameSlot(left: TagSlot, right: TagSlot): boolean {
  if (left.kind === "tuple" || right.kind === "tuple") {
    return left.kind === right.kind;
  }
  return left.key === right.key;
}

// A property tag the base enumerates but no branch claims still validates, with only the base shape.
function fallbackBranch(node: SchemaNode, dispatch: readonly DispatchBranch[]): Typed | null {
  const slot = dispatch[0]?.slot;
  if (slot === undefined || slot.kind === "tuple") {
    return null;
  }
  const property = node.properties?.[slot.key];
  if (property === undefined || typeof property === "boolean" || property.enum === undefined) {
    return null;
  }
  const claimed = new Set(dispatch.flatMap((branch) => branch.tag));
  const unclaimed = property.enum.filter((value) => !claimed.has(value));
  if (unclaimed.length === 0) {
    return null;
  }
  const member: TsMember = {
    key: slot.key,
    optional: false,
    type: unionOf(unclaimed.map(literal)),
    notes: [],
  };
  return { type: { kind: "object", members: [member] }, notes: [] };
}

function literal(value: Literal): TsName {
  return { kind: "name", text: JSON.stringify(value) };
}

function tupleOf(types: readonly TsType[], required: number, rest: TsType | null): TsTuple {
  const elements = types.map((type, index) => ({ type, optional: index >= required }));
  return { kind: "tuple", elements, rest };
}

function aliasReference(name: string): Typed {
  return { type: { kind: "name", text: name }, notes: [] };
}

function record(key: TsType, value: TsType, partial: boolean): TsRecord {
  return { kind: "record", key, value, partial };
}

// TypeScript lets only the trailing elements of a tuple be optional.
function defaultedTailStart(prefix: readonly Schema[]): number {
  const lastUndefaulted = prefix.findLastIndex(
    (element) => typeof element === "boolean" || element.default === undefined,
  );
  return lastUndefaulted + 1;
}

function unionOf(types: readonly TsType[]): TsType {
  const flat = types.flatMap((type) => (type.kind === "union" ? type.members : [type]));
  if (flat.includes(UNKNOWN)) {
    return UNKNOWN;
  }
  const seen = new Set<string>();
  const members = flat.filter((type) => {
    const key = JSON.stringify(type);
    if (type === NEVER || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
  const [only, ...others] = members;
  if (only === undefined) {
    return NEVER;
  }
  return others.length === 0 ? only : { kind: "union", members };
}

function intersectionOf(types: readonly TsType[]): TsType {
  const flat = types.flatMap((type) => (type.kind === "intersection" ? type.parts : [type]));
  if (flat.includes(NEVER)) {
    return NEVER;
  }
  const parts = flat.filter((type) => type !== UNKNOWN);
  const [only, ...others] = parts;
  if (only === undefined) {
    return UNKNOWN;
  }
  return others.length === 0 ? only : { kind: "intersection", parts };
}

// Only a lone branch, or one beside null, passes its notes up: on any other union a note could not
// say which branch it belongs to.
function unionTyped(branches: readonly Typed[]): Typed {
  const type = unionOf(branches.map((branch) => branch.type));
  const valued = branches.filter((branch) => !isNull(branch.type));
  return { type, notes: valued.length === 1 ? valued.flatMap((branch) => branch.notes) : [] };
}

function isNull(type: TsType): boolean {
  return type.kind === "name" && type.text === NULL.text;
}

function intersectionTyped(parts: readonly Typed[]): Typed {
  return {
    type: intersectionOf(parts.map((part) => part.type)),
    notes: parts.flatMap((part) => part.notes),
  };
}

function stringNotes(node: SchemaNode): string[] {
  const notes = lengthNotes(node.minLength, node.maxLength);
  if (node.format !== undefined) {
    notes.push(node.format);
  }
  if (node.pattern !== undefined) {
    notes.push(`/${node.pattern}/`);
  }
  return notes;
}

function lengthNotes(minimum: number | undefined, maximum: number | undefined): string[] {
  if (minimum === 1 && maximum === undefined) {
    return ["non-empty"];
  }
  return countNotes(minimum, maximum, "chars");
}

function countNotes(
  minimum: number | undefined,
  maximum: number | undefined,
  unit: string,
): string[] {
  const lower = minimum === 0 ? undefined : minimum;
  if (lower !== undefined && maximum !== undefined) {
    return [lower === maximum ? `${lower} ${unit}` : `${lower}-${maximum} ${unit}`];
  }
  if (lower !== undefined) {
    return [`>=${lower} ${unit}`];
  }
  return maximum === undefined ? [] : [`<=${maximum} ${unit}`];
}

function rangeNotes(node: SchemaNode): string[] {
  const minimum =
    node.minimum !== undefined && node.minimum > -SAFE_INTEGER_BOUND ? node.minimum : undefined;
  const maximum =
    node.maximum !== undefined && node.maximum < SAFE_INTEGER_BOUND ? node.maximum : undefined;
  if (minimum !== undefined && maximum !== undefined && minimum >= 0) {
    return [`${minimum}-${maximum}`];
  }
  const bounds = [
    minimum === undefined ? null : `>=${minimum}`,
    node.exclusiveMinimum === undefined ? null : `>${node.exclusiveMinimum}`,
    maximum === undefined ? null : `<=${maximum}`,
    node.exclusiveMaximum === undefined ? null : `<${node.exclusiveMaximum}`,
  ];
  return bounds.filter((bound) => bound !== null);
}

function annotationNotes(node: SchemaNode): string[] {
  const notes: string[] = [];
  if (node.default !== undefined) {
    notes.push(`default ${JSON.stringify(node.default)}`);
  }
  if (node.description !== undefined) {
    notes.push(node.description.replace(/\s+/g, " ").trim());
  }
  return notes;
}

function nestedNotes(label: string, notes: readonly string[]): string[] {
  return notes.length === 0 ? [] : [`${label}: ${notes.join(NESTED_NOTE_SEPARATOR)}`];
}

function declaration(name: string, typed: Typed): string {
  const text = print(typed.type);
  const comment = typed.notes.length === 0 ? [] : [`// ${typed.notes.join(NOTE_SEPARATOR)}`];
  return [...comment, `type ${name} =${spaceBefore(text)}${text}`].join("\n");
}

function spaceBefore(text: string): string {
  return text.startsWith("\n") ? "" : " ";
}

function print(type: TsType): string {
  switch (type.kind) {
    case "name": {
      return type.text;
    }
    case "array": {
      return `${grouped(type.element)}[]`;
    }
    case "tuple": {
      return printTuple(type);
    }
    case "object": {
      return printObject(type);
    }
    case "record": {
      return printRecord(type);
    }
    case "union": {
      return printUnion(type);
    }
    case "intersection": {
      return type.parts
        .map((part) => (part.kind === "union" ? grouped(part) : print(part)))
        .join(" & ");
    }
  }
}

function grouped(type: TsType): string {
  const text = print(type);
  if (type.kind !== "union" && type.kind !== "intersection") {
    return text;
  }
  return text.startsWith("\n") ? `(${text}\n)` : `(${text})`;
}

function printRecord(type: TsRecord): string {
  const keys = print(type.key);
  const text = `Record<${keys.includes("\n") ? grouped(type.key) : keys}, ${print(type.value)}>`;
  return type.partial ? `Partial<${text}>` : text;
}

function singleLine(text: string): string {
  return text.replace(/\s*\n\s*/g, " ").trim();
}

function printTuple(tuple: TsTuple): string {
  const elements = tuple.elements.map((element) =>
    element.optional ? `${grouped(element.type)}?` : print(element.type),
  );
  const rest = tuple.rest === null ? [] : [`...${grouped(tuple.rest)}[]`];
  return `[${[...elements, ...rest].join(", ")}]`;
}

function printUnion(union: TsUnion): string {
  const members = union.members.map(print);
  const inline = members.join(" | ");
  if (inline.length <= ONE_LINE_UNION_MAX && !inline.includes("\n")) {
    return inline;
  }
  return members.map((member) => `\n| ${member}`).join("");
}

function printObject(object: TsObject): string {
  const members = object.members.map(printMember);
  const inline = `{ ${members.join(", ")} }`;
  const commented = object.members.some((member) => member.notes.length > 0);
  if (!commented && !inline.includes("\n") && inline.length < ONE_LINE_OBJECT_MAX) {
    return inline;
  }
  return `{\n${members.join("\n")}\n}`;
}

function printMember(member: TsMember): string {
  const key = IDENTIFIER.test(member.key) ? member.key : JSON.stringify(member.key);
  const type = print(member.type);
  const line = `${key}${member.optional ? "?" : ""}:${spaceBefore(type)}${type}`;
  if (member.notes.length === 0) {
    return line;
  }
  const comment = `// ${member.notes.join(NOTE_SEPARATOR)}`;
  return type.includes("\n") ? `${comment}\n${line}` : `${line} ${comment}`;
}
