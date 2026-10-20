import { z } from "zod";

import type { HttpMethod } from "../http/transport";
import type { FeatureName } from "../version/features";
import { inputGatesOf } from "../version/input-gate-registry";
import type { InputGate } from "../version/input-gates";
import type { MethodKey } from "../version/requirements";

const SchemaNode = z.looseObject({
  $ref: z.string().optional(),
  get properties() {
    return z.record(z.string(), SchemaNode).optional();
  },
  get allOf() {
    return z.array(SchemaNode).optional();
  },
  get anyOf() {
    return z.array(SchemaNode).optional();
  },
  get oneOf() {
    return z.array(SchemaNode).optional();
  },
});
type SchemaNode = z.infer<typeof SchemaNode>;

const MediaType = z.looseObject({ schema: SchemaNode.optional() });

const Operation = z.looseObject({
  requestBody: z.looseObject({ content: z.record(z.string(), MediaType) }).optional(),
});
type Operation = z.infer<typeof Operation>;

const PathItem = z.looseObject({
  get: Operation.optional(),
  head: Operation.optional(),
  options: Operation.optional(),
  post: Operation.optional(),
  put: Operation.optional(),
  patch: Operation.optional(),
  delete: Operation.optional(),
});

const OPERATION_KEY = {
  GET: "get",
  HEAD: "head",
  OPTIONS: "options",
  POST: "post",
  PUT: "put",
  PATCH: "patch",
  DELETE: "delete",
} as const satisfies Record<HttpMethod, keyof typeof PathItem.shape>;

export function isHttpMethod(value: string): value is HttpMethod {
  return Object.hasOwn(OPERATION_KEY, value);
}

export const OpenApiBodies = z.looseObject({
  paths: z.record(z.string(), PathItem),
  components: z.looseObject({ schemas: z.record(z.string(), SchemaNode) }),
});
export type OpenApiBodies = z.infer<typeof OpenApiBodies>;

export interface BodyRoute {
  readonly key: MethodKey;
  readonly method: HttpMethod;
  readonly path: string;
  readonly input: z.ZodObject<z.core.$ZodShape>;
}

export interface MissingField {
  readonly key: MethodKey;
  readonly field: string;
}

export interface ExcusedField {
  readonly key: MethodKey;
  readonly field: string;
  readonly feature: FeatureName;
}

export interface ExtraFields {
  readonly key: MethodKey;
  readonly fields: readonly string[];
}

// `noJsonBody`: the operation declares no JSON request body. `openBody`: it declares one that names
// no property, as a bare map or `any` does. Neither can show a missing field.
export type UncheckedReason = "noJsonBody" | "openBody";

export interface UncheckedRoute {
  readonly key: MethodKey;
  readonly reason: UncheckedReason;
}

export interface OpenApiDrift {
  readonly missingRoutes: readonly MethodKey[];
  readonly missing: readonly MissingField[];
  readonly excused: readonly ExcusedField[];
  readonly extras: readonly ExtraFields[];
  readonly unchecked: readonly UncheckedRoute[];
  readonly checked: number;
}

const JSON_MEDIA_TYPE = "application/json";
const COMPONENT_REF_PREFIX = "#/components/schemas/";
const PATH_PARAMETER = /\{[^}]*\}/g;
const TRAILING_SLASH = /\/$/;

export function openApiDrift(
  spec: OpenApiBodies,
  routes: readonly BodyRoute[],
  serverHasFeature: (feature: FeatureName) => boolean,
): OpenApiDrift {
  const operations = indexOperations(spec.paths);
  const missingRoutes: MethodKey[] = [];
  const missing: MissingField[] = [];
  const excused: ExcusedField[] = [];
  const extras: ExtraFields[] = [];
  const unchecked: UncheckedRoute[] = [];
  let checked = 0;

  for (const { key, method, path, input } of routes) {
    const operation = operationAt(operations, method, path);
    if (operation === null) {
      missingRoutes.push(key);
      continue;
    }
    const body = jsonBodyOf(operation);
    if (body === null) {
      unchecked.push({ key, reason: "noJsonBody" });
      continue;
    }
    const declared = declaredFields(body, spec.components.schemas);
    if (declared.size === 0) {
      unchecked.push({ key, reason: "openBody" });
      continue;
    }
    checked += 1;
    for (const [field, schema] of Object.entries(input.shape)) {
      if (declared.has(field)) {
        continue;
      }
      const feature = excusingFeature(schema, serverHasFeature);
      if (feature === null) {
        missing.push({ key, field });
      } else {
        excused.push({ key, field, feature });
      }
    }
    const undeclared = [...declared].filter((field) => !Object.hasOwn(input.shape, field));
    if (undeclared.length > 0) {
      extras.push({ key, fields: undeclared });
    }
  }

  return { missingRoutes, missing, excused, extras, unchecked, checked };
}

function normalizePath(path: string): string {
  return path.replaceAll(PATH_PARAMETER, "{}").replace(TRAILING_SLASH, "");
}

function operationId(operationKey: string, path: string): string {
  return `${operationKey} ${normalizePath(path)}`;
}

interface DeclaredOperation {
  readonly path: string;
  readonly operation: Operation;
}

type Declarations = [DeclaredOperation, ...DeclaredOperation[]];

// Two document paths that differ only in a parameter's name or a trailing slash are one route to a
// caller. Metabase declares some of those twice for one operation, so the index keeps every
// declaration and a route that lands on more than one is refused rather than judged against either.
function indexOperations(paths: OpenApiBodies["paths"]): Map<string, Declarations> {
  const index = new Map<string, Declarations>();
  for (const [path, item] of Object.entries(paths)) {
    for (const operationKey of Object.values(OPERATION_KEY)) {
      const operation = item[operationKey];
      if (operation === undefined) {
        continue;
      }
      const id = operationId(operationKey, path);
      const declared = index.get(id);
      if (declared === undefined) {
        index.set(id, [{ path, operation }]);
      } else {
        declared.push({ path, operation });
      }
    }
  }
  return index;
}

function operationAt(
  index: Map<string, Declarations>,
  method: HttpMethod,
  path: string,
): Operation | null {
  const id = operationId(OPERATION_KEY[method], path);
  const declared = index.get(id);
  if (declared === undefined) {
    return null;
  }
  const [only, ...others] = declared;
  if (others.length > 0) {
    const paths = declared.map((entry) => entry.path).join(", ");
    throw new Error(`OpenAPI paths ${paths} all declare ${id}`);
  }
  return only.operation;
}

function jsonBodyOf(operation: Operation): SchemaNode | null {
  const schema = operation.requestBody?.content[JSON_MEDIA_TYPE]?.schema;
  return schema === undefined ? null : schema;
}

function declaredFields(
  body: SchemaNode,
  schemas: OpenApiBodies["components"]["schemas"],
): ReadonlySet<string> {
  const fields = new Set<string>();
  const visited = new Set<string>();
  const pending: SchemaNode[] = [body];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if (node.properties !== undefined) {
      for (const field of Object.keys(node.properties)) {
        fields.add(field);
      }
    }
    for (const branches of [node.allOf, node.anyOf, node.oneOf]) {
      if (branches !== undefined) {
        pending.push(...branches);
      }
    }
    if (node.$ref !== undefined && !visited.has(node.$ref)) {
      visited.add(node.$ref);
      pending.push(componentAt(node.$ref, schemas));
    }
  }
  return fields;
}

function componentAt(ref: string, schemas: OpenApiBodies["components"]["schemas"]): SchemaNode {
  if (!ref.startsWith(COMPONENT_REF_PREFIX)) {
    throw new Error(`OpenAPI $ref ${ref} points outside components.schemas`);
  }
  const name = ref.slice(COMPONENT_REF_PREFIX.length).replaceAll("~1", "/").replaceAll("~0", "~");
  const component = schemas[name];
  if (component === undefined) {
    throw new Error(`OpenAPI $ref ${ref} names no component schema`);
  }
  return component;
}

// Only a gate on the field's presence explains its absence from a server's body: a gate on some of
// its values leaves the field itself on every server. A server without a field it `needs` does not
// declare it, and neither does one that holds the feature a field is `droppedBy`.
function excusingFeature(
  field: z.core.$ZodType,
  serverHasFeature: (feature: FeatureName) => boolean,
): FeatureName | null {
  const gates = inputGatesOf(field);
  if (gates === null) {
    return null;
  }
  const excuse = gates.find(
    (gate) => gate.when.kind === "present" && excuses(gate, serverHasFeature),
  );
  return excuse === undefined ? null : excuse.feature;
}

function excuses(gate: InputGate, serverHasFeature: (feature: FeatureName) => boolean): boolean {
  switch (gate.effect) {
    case "needs": {
      return !serverHasFeature(gate.feature);
    }
    case "droppedBy": {
      return serverHasFeature(gate.feature);
    }
    case "supersededBy": {
      return false;
    }
  }
}
