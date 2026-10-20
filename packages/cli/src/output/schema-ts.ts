import { z } from "zod";

import { decodePointer, NOTE_SEPARATOR } from "../runtime/json-schema";

const TypeName = z.enum(["object", "array", "string", "number", "integer", "boolean", "null"]);
type TypeName = z.infer<typeof TypeName>;

// Every integer is a number, so a test on "number" leaves no integer for an "integer" branch.
const JSON_TYPES = TypeName.exclude(["integer"]).options;

const Literal = z.union([z.string(), z.number(), z.boolean(), z.null()]);
type Literal = z.infer<typeof Literal>;

const SchemaNode = z.looseObject({
  $ref: z.string().optional(),
  get $defs() {
    return z.record(z.string(), Schema).optional();
  },
  type: z.union([TypeName, z.array(TypeName)]).optional(),
  const: Literal.optional(),
  enum: z.array(Literal).optional(),
  get properties() {
    return z.record(z.string(), Schema).optional();
  },
  required: z.array(z.string()).optional(),
  get additionalProperties() {
    return Schema.optional();
  },
  get propertyNames() {
    return Schema.optional();
  },
  get items() {
    return Schema.optional();
  },
  get prefixItems() {
    return z.array(Schema).optional();
  },
  get anyOf() {
    return z.array(Schema).optional();
  },
  get oneOf() {
    return z.array(Schema).optional();
  },
  get allOf() {
    return z.array(Schema).optional();
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
export type SchemaNode = z.infer<typeof SchemaNode>;

export const Schema = z.union([z.boolean(), SchemaNode]);
export type Schema = z.infer<typeof Schema>;

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
  readonly notes: readonly Note[];
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

// Where a schema node sits: its document's key and a JSON Pointer into that document.
export interface SchemaLocation {
  readonly document: string;
  readonly pointer: string;
}

// A note and the node whose rule it states. A node built while converting another (a narrowed
// branch, a tagged dispatch shape) states its rules at its source's location.
interface StatedNote {
  readonly kind: "stated";
  readonly text: string;
  readonly location: SchemaLocation;
}

interface NoteGroup {
  readonly kind: "group";
  readonly label: string;
  readonly notes: readonly Note[];
}

type Note = StatedNote | NoteGroup;

interface PrintedNote {
  readonly location: SchemaLocation;
  readonly text: string;
}

export interface RenderedTypeScript {
  readonly text: string;
  readonly notes: readonly PrintedNote[];
}

interface Typed {
  readonly type: TsType;
  readonly notes: readonly Note[];
}

const UNKNOWN: TsName = { kind: "name", text: "unknown" };
const NEVER: TsName = { kind: "name", text: "never" };
const STRING: TsName = { kind: "name", text: "string" };
const NUMBER: TsName = { kind: "name", text: "number" };
const BOOLEAN: TsName = { kind: "name", text: "boolean" };
const NULL: TsName = { kind: "name", text: "null" };

const UNTYPED: Typed = { type: UNKNOWN, notes: [] };

// Zod bounds every integer by ±Number.MAX_SAFE_INTEGER, which says nothing a reader needs.
const UNSTATED_BOUND = Number.MAX_SAFE_INTEGER;
const ONE_LINE_OBJECT_MAX = 100;
const ONE_LINE_UNION_MAX = 90;
const NESTED_NOTE_SEPARATOR = ", ";
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const DEFS_POINTER = "/$defs/";
// Zod names a schema it extracts only because it is reused `__schema<N>`; the name means nothing.
const UNNAMED_DEF = /^__schema(\d+)$/;
const PROMOTED_PREFIX = "Schema";
const ENTRY_DOCUMENT = "";
const ENTRY_POINTER = "";
const ALTERNATIVE_KEYWORDS = ["anyOf", "oneOf"] as const;
const DISPATCH_MEMBER_KEYWORDS = ["if", "then"];
const OPEN_OBJECTS_HEADER = "// Objects accept keys beyond the ones listed.";
const OPEN_DISPATCH_HEADER = "// A tag beyond the ones listed is accepted unchecked.";

export interface RenderOptions {
  readonly name: string;
  readonly documentName?: string;
  readonly documents?: Readonly<Record<string, unknown>>;
}

interface Document {
  readonly key: string;
  readonly root: Schema;
}

interface Place {
  readonly document: Document;
  readonly pointer: string;
}

interface ResolvedRef {
  readonly place: Place;
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

interface Dispatch {
  readonly slot: TagSlot;
  readonly branches: readonly DispatchBranch[];
}

export function renderTypeScript(input: unknown, options: RenderOptions): string {
  return renderTypeScriptWithNotes(input, options).text;
}

// The notes are the ones the text prints, each with the location of the node that states it.
export function renderTypeScriptWithNotes(
  input: unknown,
  options: RenderOptions,
): RenderedTypeScript {
  const entryKey = options.documentName ?? ENTRY_DOCUMENT;
  const entry: Document = { key: entryKey, root: Schema.parse(input) };
  const documents = new Map(
    [...parseDocuments(options.documents), entry].map((document) => [document.key, document]),
  );
  const aliasOwners = new Map<string, string>([[options.name, `${entryKey}#`]]);
  const declarations: string[] = [];
  const printed: PrintedNote[] = [];
  const inlining = new Set<string>();
  const recursive = new Set<string>();
  let sawOpenObject = false;
  let sawOpenDispatch = false;

  declare(options.name, convert(entry.root, { document: entry, pointer: ENTRY_POINTER }));
  const header = [
    ...(sawOpenObject ? [OPEN_OBJECTS_HEADER] : []),
    ...(sawOpenDispatch ? [OPEN_DISPATCH_HEADER] : []),
  ];
  return { text: [...header, ...declarations].join("\n"), notes: printed };

  function declare(name: string, typed: Typed): void {
    declarations.push(declaration(name, typed));
    printed.push(...typed.notes.flatMap(statedNotes), ...memberNotes(typed.type));
  }

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
    const place = { document, pointer: fragment };
    if (fragment === "") {
      return { place, name: null, schema: document.root };
    }
    const pointer = fragment.slice(DEFS_POINTER.length);
    const name = decodePointer(pointer);
    const defs = typeof document.root === "boolean" ? undefined : document.root.$defs;
    const target = defs?.[name];
    if (target === undefined) {
      throw new Error(`$ref "${ref}" points at no $defs entry`);
    }
    return { place, name, schema: target };
  }

  function convertRef(ref: string, from: Document): Typed {
    const resolved = resolve(ref, from);
    if (resolved.name === null) {
      if (resolved.place.document !== entry) {
        throw new Error(`$ref "${ref}" names a whole document`);
      }
      return aliasReference(options.name);
    }
    const id = `${resolved.place.document.key}#${resolved.name}`;
    const unnamed = UNNAMED_DEF.exec(resolved.name);
    if (unnamed !== null) {
      return convertUnnamed(`${PROMOTED_PREFIX}${unnamed[1]}`, id, resolved);
    }
    if (claimName(resolved.name, id)) {
      declare(resolved.name, convert(resolved.schema, resolved.place));
    }
    return aliasReference(resolved.name);
  }

  function convertUnnamed(name: string, id: string, resolved: ResolvedRef): Typed {
    if (aliasOwners.get(name) === id) {
      return aliasReference(name);
    }
    if (inlining.has(id)) {
      recursive.add(id);
      return aliasReference(name);
    }
    inlining.add(id);
    const inlined = convert(resolved.schema, resolved.place);
    inlining.delete(id);
    if (!recursive.has(id)) {
      return inlined;
    }
    claimName(name, id);
    declare(name, inlined);
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

  function convert(schema: Schema, place: Place): Typed {
    if (schema === true) {
      return UNTYPED;
    }
    if (schema === false) {
      return { type: NEVER, notes: [] };
    }
    checkKeywords(schema);
    const core = convertCore(schema, place);
    return { type: core.type, notes: [...core.notes, ...statedAt(annotationNotes(schema), place)] };
  }

  function checkKeywords(node: SchemaNode): void {
    for (const keyword of Object.keys(node)) {
      if (!HANDLED.has(keyword) && !IGNORED.has(keyword)) {
        throw new Error(`unsupported JSON Schema keyword "${keyword}"`);
      }
    }
  }

  function convertCore(node: SchemaNode, place: Place): Typed {
    if (node.const !== undefined) {
      return { type: literal(node.const), notes: [] };
    }
    if (node.enum !== undefined) {
      return { type: unionOf(node.enum.map(literal)), notes: [] };
    }
    const dispatch = node.allOf === undefined ? null : readDispatch(node.allOf);
    const implied = withoutImpliedCount(node, dispatch, place.document);
    const base = convertConditionalBase(implied, place);
    const composites = [
      ...(node.$ref === undefined ? [] : [convertRef(node.$ref, place.document)]),
      ...convertAlternatives(node, place),
      ...(node.allOf === undefined ? [] : [convertAllOf(node, node.allOf, dispatch, place)]),
    ];
    return combine(base, composites);
  }

  // Each tuple a dispatch selects states its own length, so a base minItems that every one of them
  // meets is already in the type.
  function withoutImpliedCount(
    node: SchemaNode,
    dispatch: Dispatch | null,
    document: Document,
  ): SchemaNode {
    const { minItems, ...rest } = node;
    if (minItems === undefined || dispatch === null || dispatch.slot.kind !== "tuple") {
      return node;
    }
    const met = dispatch.branches.every(
      (branch) => requiredLength(branch.shape, document) >= minItems,
    );
    return met ? rest : node;
  }

  function requiredLength(shape: Schema, document: Document): number {
    if (typeof shape === "boolean") {
      return 0;
    }
    if (shape.minItems !== undefined || shape.$ref === undefined) {
      return shape.minItems ?? shape.prefixItems?.length ?? 0;
    }
    const target = resolve(shape.$ref, document);
    return requiredLength(target.schema, target.place.document);
  }

  function convertAlternatives(node: SchemaNode, place: Place): Typed[] {
    return ALTERNATIVE_KEYWORDS.flatMap((keyword) => {
      const list = node[keyword];
      if (list === undefined) {
        return [];
      }
      return [unionTyped(list.map((branch, index) => convert(branch, at(place, keyword, index))))];
    });
  }

  function convertConditionalBase(node: SchemaNode, place: Place): Typed | null {
    const conditional = readConditional(node);
    if (conditional === null) {
      return convertBase(node, place);
    }
    const tested = readTypeTest(conditional.test);
    if (tested !== null) {
      return convertTypeTest(node, conditional, tested, place);
    }
    throw new Error(
      `unsupported "if" outside an allOf dispatch: ${JSON.stringify(conditional.test)}`,
    );
  }

  function convertBase(node: SchemaNode, place: Place): Typed | null {
    const types = declaredTypes(node);
    if (types.length > 0) {
      return unionTyped(types.map((type) => convertTyped(node, type, place)));
    }
    return node.$ref === undefined ? null : convertRefSiblings(node, node.$ref, place);
  }

  // A `$ref`'s sibling assertions narrow whatever its target admits, so they read under the
  // target's types. Integer counts as number here: the target's own notes already say int.
  function convertRefSiblings(node: SchemaNode, ref: string, place: Place): Typed | null {
    const types = referencedTypes(ref, place.document, new Set());
    if (types.length === 0) {
      return null;
    }
    const asserted = new Set(types.map((type) => (type === "integer" ? "number" : type)));
    return unionTyped([...asserted].map((type) => convertTyped(node, type, place)));
  }

  function referencedTypes(ref: string, from: Document, seen: Set<string>): readonly TypeName[] {
    const resolved = resolve(ref, from);
    const id = `${resolved.place.document.key}#${resolved.name ?? ""}`;
    if (typeof resolved.schema === "boolean" || seen.has(id)) {
      return [];
    }
    seen.add(id);
    const types = declaredTypes(resolved.schema);
    if (types.length > 0 || resolved.schema.$ref === undefined) {
      return types;
    }
    return referencedTypes(resolved.schema.$ref, resolved.place.document, seen);
  }

  function convertTypeTest(
    node: SchemaNode,
    conditional: Conditional,
    tested: TypeName,
    place: Place,
  ): Typed | null {
    const { consequent, alternative } = conditional;
    if (consequent === null) {
      return convertBase(node, place);
    }
    const stated = node.type !== undefined;
    const declared = stated ? declaredTypes(node) : JSON_TYPES;
    const passing = new Set(
      declared.map((type) => overlap(tested, type)).filter((type) => type !== null),
    );
    const then = at(place, "then");
    const passed = [...passing].map((type) => convert(narrow(consequent, type), then));
    const failing = declared.filter((type) => !passesWhole(tested, type));
    if (alternative === null) {
      return unionTyped([...failing.map((type) => convertTyped(node, type, place)), ...passed]);
    }
    const otherwise = at(place, "else");
    if (!stated) {
      return unionTyped([...passed, convert(alternative, otherwise)]);
    }
    const failed = failing.map((type) =>
      combine(convertTyped(node, type, place), [convert(narrow(alternative, type), otherwise)]),
    );
    return unionTyped([...passed, ...failed]);
  }

  function convertAllOf(
    node: SchemaNode,
    members: readonly Schema[],
    dispatch: Dispatch | null,
    place: Place,
  ): Typed {
    if (dispatch === null) {
      return intersectionTyped(
        members.map((member, index) => convert(member, at(place, "allOf", index))),
      );
    }
    const unclaimed = unclaimedTags(node, dispatch, place.document);
    if (unclaimed === null) {
      sawOpenDispatch = true;
    }
    const branches = dispatch.branches.map((branch, index) =>
      convertBranch(branch, at(place, "allOf", index, "then")),
    );
    const fallback = unclaimed === null ? null : fallbackBranch(dispatch.slot, unclaimed);
    return unionTyped(fallback === null ? branches : [...branches, fallback]);
  }

  // The validator checks a tag no branch claims only against what the base says of the tag slot,
  // so a base listing no tags accepts any other tag unchecked (null here), and a tag the base lists
  // that no branch claims still validates with only the base shape.
  function unclaimedTags(
    node: SchemaNode,
    { slot, branches }: Dispatch,
    document: Document,
  ): readonly Literal[] | null {
    const base = slot.kind === "tuple" ? node.prefixItems?.[0] : node.properties?.[slot.key];
    const listed = base === undefined ? null : listedLiterals(base, document);
    if (listed === null) {
      return null;
    }
    const claimed = new Set(branches.flatMap((branch) => branch.tag));
    return listed.filter((value) => !claimed.has(value));
  }

  function convertBranch(branch: DispatchBranch, place: Place): Typed {
    const { slot, shape } = branch;
    if (slot.kind === "tuple" || typeof shape === "boolean") {
      return convert(shape, place);
    }
    if (shape.$ref !== undefined) {
      const tagType = unionOf(branch.tag.map(literal));
      const tag: TsMember = { key: slot.key, optional: false, type: tagType, notes: [] };
      const tagged: TsObject = { kind: "object", members: [tag] };
      return intersectionTyped([convert(shape, place), { type: tagged, notes: [] }]);
    }
    const tagged: SchemaNode = {
      ...shape,
      type: "object",
      properties: { [slot.key]: { enum: [...branch.tag] }, ...shape.properties },
      required: [slot.key, ...(shape.required ?? [])],
    };
    return convert(tagged, place);
  }

  function convertTyped(node: SchemaNode, type: TypeName, place: Place): Typed {
    switch (type) {
      case "string": {
        return { type: STRING, notes: statedAt(stringNotes(node), place) };
      }
      case "number": {
        return { type: NUMBER, notes: statedAt(rangeNotes(node), place) };
      }
      case "integer": {
        return { type: NUMBER, notes: statedAt(["int", ...rangeNotes(node)], place) };
      }
      case "boolean": {
        return { type: BOOLEAN, notes: [] };
      }
      case "null": {
        return { type: NULL, notes: [] };
      }
      case "array": {
        return convertArray(node, place);
      }
      case "object": {
        return convertObject(node, place);
      }
    }
  }

  function convertArray(node: SchemaNode, place: Place): Typed {
    if (node.prefixItems !== undefined) {
      return convertTuple(node, node.prefixItems, place);
    }
    const element = node.items === undefined ? UNTYPED : convert(node.items, at(place, "items"));
    return {
      type: { kind: "array", element: element.type },
      notes: [
        ...statedAt(countNotes(node.minItems, node.maxItems, "items"), place),
        ...nestedNotes("items", element.notes),
      ],
    };
  }

  // JSON Schema reads a tuple with no minItems as all optional; this reads it as all required, since
  // a tuple names its elements to have them. An absent `items` leaves the tail open, as it does.
  function convertTuple(node: SchemaNode, prefix: readonly Schema[], place: Place): Typed {
    const elements = prefix.map((element, index) =>
      convert(element, at(place, "prefixItems", index)),
    );
    const fixed = elements.map((element) => element.type);
    const elementNotes = elements.flatMap((element, index) =>
      nestedNotes(`[${index}]`, element.notes),
    );
    const required = node.minItems ?? prefix.length;
    if (node.items === false) {
      return { type: tupleOf(fixed, required, null), notes: elementNotes };
    }
    const rest = node.items === undefined ? UNTYPED : convert(node.items, at(place, "items"));
    const spelled = Math.max(fixed.length, node.maxItems ?? required);
    const spelledRest = Array.from({ length: spelled - fixed.length }, () => rest.type);
    const openRest = node.maxItems === undefined ? rest.type : null;
    return {
      type: tupleOf([...fixed, ...spelledRest], required, openRest),
      notes: [...elementNotes, ...nestedNotes("rest", rest.notes)],
    };
  }

  function convertObject(node: SchemaNode, place: Place): Typed {
    const members = convertMembers(node, place);
    const extra =
      node.additionalProperties === undefined
        ? UNTYPED
        : convert(node.additionalProperties, at(place, "additionalProperties"));
    if (members.length > 0) {
      return objectWithExtra({ kind: "object", members }, extra, place);
    }
    if (extra.type === NEVER) {
      return { type: record(STRING, NEVER, false), notes: [] };
    }
    return convertRecord(node, extra, place);
  }

  function convertMembers(node: SchemaNode, place: Place): TsMember[] {
    if (node.properties === undefined) {
      return [];
    }
    const required = new Set(node.required);
    return Object.entries(node.properties).map(([key, property]) => {
      const typed = convert(property, at(place, "properties", key));
      return { key, optional: !required.has(key), type: typed.type, notes: typed.notes };
    });
  }

  // TypeScript cannot say "these members, and any other key of type V" without forcing V to admit
  // every member's type too, so a typed catchall is stated in the comment instead.
  function objectWithExtra(object: TsObject, extra: Typed, place: Place): Typed {
    if (extra.type === NEVER) {
      return { type: object, notes: [] };
    }
    if (extra.type === UNKNOWN) {
      sawOpenObject = true;
      return { type: object, notes: [] };
    }
    return {
      type: object,
      notes: statedAt([`other keys: ${singleLine(print(extra.type))}`], place),
    };
  }

  // Zod moves an enum it sees twice into $defs, so the literals may sit behind a $ref.
  function listedLiterals(schema: Schema, document: Document): readonly Literal[] | null {
    if (typeof schema === "boolean" || schema.$ref === undefined) {
      return literalValues(schema);
    }
    const resolved = resolve(schema.$ref, document);
    return listedLiterals(resolved.schema, resolved.place.document);
  }

  function convertRecord(node: SchemaNode, value: Typed, place: Place): Typed {
    const valueNotes = nestedNotes("values", value.notes);
    if (node.propertyNames === undefined) {
      return { type: record(STRING, value.type, false), notes: valueNotes };
    }
    // JSON Schema applies propertyNames to keys, and a key is always a string.
    const keys = convert(narrow(node.propertyNames, "string"), at(place, "propertyNames"));
    const listed = listedLiterals(node.propertyNames, place.document);
    const required = new Set(node.required);
    const exhaustive = listed === null || listed.every((key) => required.has(String(key)));
    return {
      type: record(keys.type, value.type, !exhaustive),
      notes: [...nestedNotes("keys", keys.notes), ...valueNotes],
    };
  }
}

function at(place: Place, ...segments: readonly (string | number)[]): Place {
  return { document: place.document, pointer: appendPointer(place.pointer, segments) };
}

export function childLocation(
  location: SchemaLocation,
  ...segments: readonly (string | number)[]
): SchemaLocation {
  return { document: location.document, pointer: appendPointer(location.pointer, segments) };
}

function appendPointer(pointer: string, segments: readonly (string | number)[]): string {
  const encoded = segments.map((segment) =>
    String(segment).replaceAll("~", "~0").replaceAll("/", "~1"),
  );
  return [pointer, ...encoded].join("/");
}

function statedAt(texts: readonly string[], place: Place): StatedNote[] {
  const location = { document: place.document.key, pointer: place.pointer };
  return texts.map((text) => ({ kind: "stated", text, location }));
}

function statedNotes(note: Note): StatedNote[] {
  return note.kind === "stated" ? [note] : note.notes.flatMap(statedNotes);
}

function memberNotes(type: TsType): StatedNote[] {
  switch (type.kind) {
    case "name": {
      return [];
    }
    case "array": {
      return memberNotes(type.element);
    }
    case "tuple": {
      const rest = type.rest === null ? [] : [type.rest];
      return [...type.elements.map((element) => element.type), ...rest].flatMap(memberNotes);
    }
    case "object": {
      return type.members.flatMap((member) => [
        ...member.notes.flatMap(statedNotes),
        ...memberNotes(member.type),
      ]);
    }
    case "record": {
      return [type.key, type.value].flatMap(memberNotes);
    }
    case "union": {
      return type.members.flatMap(memberNotes);
    }
    case "intersection": {
      return type.parts.flatMap(memberNotes);
    }
  }
}

function noteText(note: Note): string {
  if (note.kind === "stated") {
    return note.text;
  }
  return `${note.label}: ${note.notes.map(noteText).join(NESTED_NOTE_SEPARATOR)}`;
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
  if (isBare(base.type)) {
    return { type: composite.type, notes: [...base.notes, ...composite.notes] };
  }
  return intersectionTyped([base, composite]);
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

// Every integer is a number, so a number test and an integer type overlap on the integers.
function overlap(tested: TypeName, declared: TypeName): TypeName | null {
  if (tested === declared) {
    return declared;
  }
  const numeric = [tested, declared].every((type) => type === "number" || type === "integer");
  return numeric ? "integer" : null;
}

function passesWhole(tested: TypeName, declared: TypeName): boolean {
  return tested === declared || (tested === "number" && declared === "integer");
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
function readDispatch(members: readonly Schema[]): Dispatch | null {
  const branches = members.map(readBranch);
  const [first] = branches;
  if (first === undefined || first === null) {
    return null;
  }
  const uniform = branches.every(
    (branch): branch is DispatchBranch => branch !== null && sameSlot(branch.slot, first.slot),
  );
  return uniform ? { slot: first.slot, branches } : null;
}

function readBranch(member: Schema): DispatchBranch | null {
  if (typeof member === "boolean" || !hasExactKeywords(member, DISPATCH_MEMBER_KEYWORDS)) {
    return null;
  }
  const conditional = readConditional(member);
  if (conditional === null || conditional.consequent === null) {
    return null;
  }
  const test = singleKeyword(conditional.test);
  if (test === null) {
    return null;
  }
  const shape = conditional.consequent;
  if (test.prefixItems !== undefined) {
    const [head, ...others] = test.prefixItems;
    if (head === undefined || others.length > 0) {
      return null;
    }
    const tag = literalValues(head);
    return tag === null ? null : { slot: { kind: "tuple" }, tag, shape };
  }
  if (test.properties === undefined) {
    return null;
  }
  const [entry, ...others] = Object.entries(test.properties);
  if (entry === undefined || others.length > 0) {
    return null;
  }
  const tag = literalValues(entry[1]);
  return tag === null ? null : { slot: { kind: "property", key: entry[0] }, tag, shape };
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

function fallbackBranch(slot: TagSlot, unclaimed: readonly Literal[]): Typed | null {
  if (slot.kind === "tuple" || unclaimed.length === 0) {
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

function unionOf(types: readonly TsType[]): TsType {
  const flat = types.flatMap((type) => (type.kind === "union" ? type.members : [type]));
  if (flat.includes(UNKNOWN)) {
    return UNKNOWN;
  }
  const seen = new Set<string>();
  // Two members a reader cannot tell apart are one, whichever nodes their notes came from.
  const members = flat.filter((type) => {
    const key = print(type);
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

function unionTyped(branches: readonly Typed[]): Typed {
  const type = unionOf(branches.map((branch) => branch.type));
  const valued = branches.filter((branch) => !isNull(branch.type) || branch.notes.length > 0);
  if (valued.length === 1) {
    return { type, notes: valued.flatMap((branch) => branch.notes) };
  }
  return { type, notes: labelledNotes(valued) };
}

function labelledNotes(branches: readonly Typed[]): Note[] {
  const totals = new Map<string, number>();
  const labelled = branches.map((branch) => {
    const label = branchLabel(branch.type);
    const ordinal = (totals.get(label) ?? 0) + 1;
    totals.set(label, ordinal);
    return { label, ordinal, branch };
  });
  return labelled.flatMap(({ label, ordinal, branch }) => {
    if (branch.notes.length === 0 || labelsOwnNotes(branch.type)) {
      return branch.notes;
    }
    const shown = totals.get(label) === 1 ? label : `${label} #${ordinal}`;
    return [{ kind: "group", label: shown, notes: branch.notes }];
  });
}

function labelsOwnNotes(type: TsType): boolean {
  return type.kind === "union" && nonNullMembers(type).length > 1;
}

function branchLabel(type: TsType): string {
  switch (type.kind) {
    case "name": {
      return type.text;
    }
    case "array": {
      return oneLineOr(print(type), type.kind);
    }
    case "tuple": {
      const head = type.elements[0];
      return head === undefined ? type.kind : oneLineOr(`[${print(head.type)}]`, type.kind);
    }
    case "union": {
      const [only, ...others] = nonNullMembers(type);
      return only !== undefined && others.length === 0 ? branchLabel(only) : type.kind;
    }
    default: {
      return type.kind;
    }
  }
}

function nonNullMembers(union: TsUnion): TsType[] {
  return union.members.filter((member) => !isNull(member));
}

function oneLineOr(text: string, fallback: string): string {
  return text.includes("\n") ? fallback : text;
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
    notes.push(oneLine(node.format));
  }
  if (node.pattern !== undefined) {
    notes.push(`/${oneLine(node.pattern)}/`);
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
  const minimum = isStatedBound(node.minimum) ? node.minimum : undefined;
  const maximum = isStatedBound(node.maximum) ? node.maximum : undefined;
  const exclusive = node.exclusiveMinimum !== undefined || node.exclusiveMaximum !== undefined;
  if (minimum !== undefined && maximum !== undefined && minimum >= 0 && !exclusive) {
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

export function isStatedBound(bound: number | undefined): bound is number {
  return bound !== undefined && Math.abs(bound) < UNSTATED_BOUND;
}

function annotationNotes(node: SchemaNode): string[] {
  const notes: string[] = [];
  if (node.default !== undefined) {
    notes.push(`default ${JSON.stringify(node.default)}`);
  }
  if (node.description !== undefined) {
    notes.push(oneLine(node.description));
  }
  return notes;
}

// A note is quoted on one `//` line, so a line break in its text would end the comment.
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function nestedNotes(label: string, notes: readonly Note[]): Note[] {
  return notes.length === 0 ? [] : [{ kind: "group", label, notes }];
}

function declaration(name: string, typed: Typed): string {
  const text = print(typed.type);
  const comment =
    typed.notes.length === 0 ? [] : [`// ${typed.notes.map(noteText).join(NOTE_SEPARATOR)}`];
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
  const comment = `// ${member.notes.map(noteText).join(NOTE_SEPARATOR)}`;
  return type.includes("\n") ? `${comment}\n${line}` : `${line} ${comment}`;
}
