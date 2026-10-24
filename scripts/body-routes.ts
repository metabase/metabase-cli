import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { z } from "zod";

import * as barrel from "@metabase/client";
import type { HttpMethod } from "@metabase/client/http/transport";
import { isHttpMethod } from "@metabase/client/testing/openapi-drift";
import { isMethodKey, type MethodKey } from "@metabase/client/version/requirements";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLIENT_SRC = resolve(HERE, "..", "packages", "client", "src");
const CLIENT_ENTRY = "client.ts";
const SOURCE_EXTENSION = ".ts";
const API_PREFIX = "/api/";
const RESOURCE_SUFFIX = "Resource";
const BODY_OPTION = "body";
const METHOD_OPTION = "method";
const OPTIONS_TYPE = "RequestOptions";
// A path parameter is a positional id or name, never the body a call builds.
const PATH_PARAMETER_TYPES: ReadonlySet<string> = new Set(["number", "string"]);
const DEFAULT_METHOD: HttpMethod = "GET";
const PATH_PARAMETER = "{}";

const WRAPPED_FUNCTION_ARGUMENT: Readonly<Record<string, number>> = {
  explain: 1,
  explainWalk: 1,
  refuse: 1,
  refuseAfterReading: 2,
};

interface BodyRequest {
  readonly method: HttpMethod;
  readonly path: string;
}

export interface PairedBody {
  readonly key: MethodKey;
  readonly request: BodyRequest;
  readonly inputName: string;
  readonly input: z.ZodObject<z.core.$ZodShape>;
}

/**
 * `bodyType` is the declared type of the parameter the body is built from, `null` when the method
 * builds it from something else.
 */
export interface UnpairedBody {
  readonly key: MethodKey;
  readonly bodyType: string | null;
}

export interface BodyMethods {
  readonly paired: readonly PairedBody[];
  readonly unpaired: readonly UnpairedBody[];
}

interface ScannedBody {
  readonly key: MethodKey;
  readonly request: BodyRequest;
  readonly bodyType: string | null;
}

interface SiblingSentBody {
  readonly key: MethodKey;
  readonly request: null;
  readonly bodyType: null;
}

type ScannedMethod = ScannedBody | SiblingSentBody;

interface SentBody {
  readonly request: BodyRequest;
  readonly source: ts.ParameterDeclaration | null;
}

interface ResourceNamespace {
  readonly namespace: string;
  readonly factory: string;
  readonly file: string;
}

interface PathScope {
  readonly constants: ReadonlyMap<string, ts.Expression>;
  readonly helpers: ReadonlyMap<string, ts.Expression>;
}

// A function on the namespace is left out: a sibling method's check covers its own body.
interface BodyHelpers {
  readonly functions: ReadonlyMap<string, ts.FunctionDeclaration>;
  readonly key: MethodKey;
  readonly chain: readonly ts.FunctionDeclaration[];
}

export function scanBodyMethods(): BodyMethods {
  const paired: PairedBody[] = [];
  const unpaired: UnpairedBody[] = [];
  for (const { key, request, bodyType } of resourceNamespaces().flatMap(bodiesOf)) {
    const input = bodyType === null ? null : barrelObject(bodyType);
    if (request === null || bodyType === null || input === null) {
      unpaired.push({ key, bodyType });
    } else {
      paired.push({ key, request, inputName: bodyType, input });
    }
  }
  return { paired, unpaired };
}

// An object schema naming no field, as an open query is, has nothing a server's body could lack. A
// union of object schemas, one per kind of body, is read as one object with every option's fields.
function barrelObject(name: string): z.ZodObject<z.core.$ZodShape> | null {
  const value: unknown = Reflect.get(barrel, name);
  const object = value instanceof z.ZodUnion ? unionObject(value) : value;
  const namesFields = object instanceof z.ZodObject && Object.keys(object.shape).length > 0;
  return namesFields ? object : null;
}

function unionObject(union: z.ZodUnion): z.ZodObject<z.core.$ZodShape> | null {
  const options: readonly unknown[] = union.options;
  if (!options.every((option) => option instanceof z.ZodObject)) {
    return null;
  }
  return z.object(Object.assign({}, ...options.map((option) => option.shape)));
}

function parseSource(file: string): ts.SourceFile {
  return ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
}

function resourceNamespaces(): ResourceNamespace[] {
  const client = parseSource(resolve(CLIENT_SRC, CLIENT_ENTRY));
  const modules = importedModules(client);
  const namespaces: ResourceNamespace[] = [];
  visit(client, (node) => {
    if (!ts.isPropertyAssignment(node) || !ts.isCallExpression(node.initializer)) {
      return;
    }
    const callee = node.initializer.expression;
    if (!ts.isIdentifier(callee) || !callee.text.endsWith(RESOURCE_SUFFIX)) {
      return;
    }
    const file = modules.get(callee.text);
    if (file === undefined) {
      throw new Error(`${CLIENT_ENTRY}: ${callee.text} is not imported`);
    }
    namespaces.push({ namespace: node.name.getText(), factory: callee.text, file });
  });
  return namespaces;
}

function importedModules(source: ts.SourceFile): Map<string, string> {
  const modules = new Map<string, string>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings)) {
      continue;
    }
    const file = resolve(CLIENT_SRC, `${statement.moduleSpecifier.text}${SOURCE_EXTENSION}`);
    for (const element of bindings.elements) {
      modules.set(element.name.text, file);
    }
  }
  return modules;
}

function bodiesOf({ namespace, factory, file }: ResourceNamespace): ScannedMethod[] {
  const source = parseSource(file);
  const definition = source.statements.find(
    (statement): statement is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(statement) && statement.name?.text === factory,
  );
  if (definition?.body === undefined) {
    throw new Error(`${file}: no function ${factory}`);
  }
  const factoryBody = definition.body;
  const functions = new Map([
    ...localFunctions(source.statements),
    ...localFunctions(factoryBody.statements),
  ]);
  const surface = returnedObject(factoryBody, file);
  const fileScope = mergeScopes(pathScope(source.statements), pathScope(factoryBody.statements));
  const methods = surface.properties.map((property) => {
    if (property.name === undefined) {
      throw new Error(`${file}: ${namespace} spreads a property the scan cannot name`);
    }
    const key = `${namespace}.${property.name.getText()}`;
    if (!isMethodKey(key)) {
      throw new Error(`${file}: ${key} is not a method key`);
    }
    return { key, name: implementingFunction(property, key) };
  });
  const surfaceNames = new Set(methods.map(({ name }) => name));
  const helpers = new Map([...functions].filter(([name]) => !surfaceNames.has(name)));
  const siblings = new Map([...functions].filter(([name]) => surfaceNames.has(name)));

  return methods.flatMap(({ key, name }): ScannedMethod[] => {
    const implementation = functions.get(name);
    if (implementation?.body === undefined) {
      throw new Error(`${file}: ${key} names no function declared in ${factory}`);
    }
    const bodyHelpers = { functions: helpers, key, chain: [implementation] };
    const sent = sentBody(implementation, fileScope, bodyHelpers);
    if (sent !== null) {
      const bodyType = sent.source?.type === undefined ? null : sent.source.type.getText();
      return [{ key, request: sent.request, bodyType }];
    }
    // A body built here and sent through a sibling method has no input the scan can name, so it
    // is reported rather than taken for a method that sends none.
    const throughSibling = sendsThroughSibling(implementation, siblings, fileScope, bodyHelpers);
    return throughSibling ? [{ key, request: null, bodyType: null }] : [];
  });
}

function sendsThroughSibling(
  fn: ts.FunctionDeclaration,
  surface: ReadonlyMap<string, ts.FunctionDeclaration>,
  scope: PathScope,
  helpers: BodyHelpers,
): boolean {
  const siblings: ts.FunctionDeclaration[] = [];
  visit(fn, (node) => {
    if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression)) {
      return;
    }
    const sibling = surface.get(node.expression.text);
    if (sibling !== undefined && sibling !== fn) {
      siblings.push(sibling);
    }
  });
  return siblings.some(
    (sibling) =>
      sentBody(sibling, scope, { ...helpers, chain: [...helpers.chain, sibling] }) !== null,
  );
}

function localFunctions(statements: readonly ts.Statement[]): Map<string, ts.FunctionDeclaration> {
  const functions = new Map<string, ts.FunctionDeclaration>();
  for (const statement of statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name !== undefined) {
      functions.set(statement.name.text, statement);
    }
  }
  return functions;
}

function returnedObject(body: ts.Block, file: string): ts.ObjectLiteralExpression {
  const returned = body.statements.find(ts.isReturnStatement)?.expression;
  if (returned === undefined || !ts.isObjectLiteralExpression(returned)) {
    throw new Error(`${file}: the resource factory does not return an object literal`);
  }
  return returned;
}

function implementingFunction(property: ts.ObjectLiteralElementLike, key: MethodKey): string {
  if (ts.isShorthandPropertyAssignment(property)) {
    return property.name.text;
  }
  if (!ts.isPropertyAssignment(property)) {
    throw new Error(`${key}: cannot tell which function the property runs`);
  }
  const value = property.initializer;
  if (ts.isIdentifier(value)) {
    return value.text;
  }
  const wrapped = wrappedFunction(value);
  if (wrapped === null) {
    throw new Error(`${key}: cannot tell which function ${value.getText()} runs`);
  }
  return wrapped;
}

function wrappedFunction(value: ts.Expression): string | null {
  if (!ts.isCallExpression(value)) {
    return null;
  }
  const position = WRAPPED_FUNCTION_ARGUMENT[value.expression.getText()];
  const wrapped = position === undefined ? undefined : value.arguments[position];
  return wrapped !== undefined && ts.isIdentifier(wrapped) ? wrapped.text : null;
}

function sentBody(
  fn: ts.FunctionDeclaration,
  scope: PathScope,
  helpers: BodyHelpers,
): SentBody | null {
  if (fn.body === undefined) {
    return null;
  }
  const fnScope = mergeScopes(scope, pathScope(nestedDeclarations(fn.body)));
  const sent: SentBody[] = [];
  visit(fn.body, (node) => {
    if (!ts.isCallExpression(node)) {
      return;
    }
    const options = node.arguments.find(
      (argument) => optionWith(localValue(argument, fn), BODY_OPTION) !== null,
    );
    if (options !== undefined) {
      sent.push(directBody(node, options, fn, fnScope, helpers.key));
      return;
    }
    const helper = ts.isIdentifier(node.expression)
      ? helpers.functions.get(node.expression.text)
      : undefined;
    if (helper === undefined || helpers.chain.includes(helper)) {
      return;
    }
    const delegated = sentBody(helper, mergeScopes(fnScope, argumentScope(helper, node, fnScope)), {
      ...helpers,
      chain: [...helpers.chain, helper],
    });
    if (delegated !== null) {
      sent.push({ request: delegated.request, source: callerSource(delegated, helper, node, fn) });
    }
  });
  const [only, ...others] = sent;
  if (others.length > 0) {
    throw new Error(`${helpers.key}: sends more than one body`);
  }
  return only === undefined ? null : only;
}

function directBody(
  call: ts.CallExpression,
  options: ts.Expression,
  fn: ts.FunctionDeclaration,
  scope: PathScope,
  key: MethodKey,
): SentBody {
  const paths = call.arguments.flatMap((argument) => {
    const path = argument === options ? null : resolvePath(argument, scope);
    return path !== null && path.startsWith(API_PREFIX) ? [path] : [];
  });
  const [path, ...otherPaths] = paths;
  if (path === undefined || otherPaths.length > 0) {
    throw new Error(`${key}: cannot tell which path ${call.getText()} sends its body to`);
  }
  const written = localValue(options, fn);
  const body = optionWith(written, BODY_OPTION);
  const source = body === null ? null : sourceParameter(body, fn);
  return { request: { method: methodOf(written, key), path }, source };
}

// Options built into a local before the call are read where they are written.
function localValue(argument: ts.Expression, fn: ts.FunctionDeclaration): ts.Expression {
  if (!ts.isIdentifier(argument)) {
    return argument;
  }
  return localInitializer(fn, argument.text) ?? argument;
}

function argumentScope(
  helper: ts.FunctionDeclaration,
  call: ts.CallExpression,
  callerScope: PathScope,
): PathScope {
  const constants = new Map<string, ts.Expression>();
  helper.parameters.forEach((parameter, index) => {
    const argument = call.arguments[index];
    const path = argument === undefined ? null : resolvePath(argument, callerScope);
    if (ts.isIdentifier(parameter.name) && path !== null) {
      constants.set(parameter.name.text, ts.factory.createStringLiteral(path));
    }
  });
  return { constants, helpers: new Map() };
}

function callerSource(
  delegated: SentBody,
  helper: ts.FunctionDeclaration,
  call: ts.CallExpression,
  caller: ts.FunctionDeclaration,
): ts.ParameterDeclaration | null {
  if (delegated.source === null) {
    return null;
  }
  const argument = call.arguments[helper.parameters.indexOf(delegated.source)];
  return argument === undefined ? null : sourceParameter(argument, caller);
}

function sourceParameter(
  expression: ts.Expression,
  fn: ts.FunctionDeclaration,
): ts.ParameterDeclaration | null {
  const unwrapped = ts.isAwaitExpression(expression) ? expression.expression : expression;
  if (ts.isIdentifier(unwrapped)) {
    const parameter = parameterNamed(fn, unwrapped.text);
    if (parameter !== null) {
      return parameter;
    }
    const local = localInitializer(fn, unwrapped.text);
    return local === null ? null : sourceParameter(local, fn);
  }
  if (!ts.isCallExpression(unwrapped)) {
    return null;
  }
  const passed = unwrapped.arguments.flatMap((argument) => {
    const parameter = ts.isIdentifier(argument) ? parameterNamed(fn, argument.text) : null;
    return parameter === null || !buildsBody(parameter) ? [] : [parameter];
  });
  const [only, ...others] = passed;
  return only === undefined || others.length > 0 ? null : only;
}

function buildsBody(parameter: ts.ParameterDeclaration): boolean {
  const type = parameter.type?.getText();
  return type !== OPTIONS_TYPE && (type === undefined || !PATH_PARAMETER_TYPES.has(type));
}

function parameterNamed(fn: ts.FunctionDeclaration, name: string): ts.ParameterDeclaration | null {
  const parameter = fn.parameters.find(
    (candidate) => ts.isIdentifier(candidate.name) && candidate.name.text === name,
  );
  return parameter === undefined ? null : parameter;
}

function localInitializer(fn: ts.FunctionDeclaration, name: string): ts.Expression | null {
  const declarations = fn.body === undefined ? [] : nestedDeclarations(fn.body);
  const declaration = declarations
    .filter(ts.isVariableStatement)
    .flatMap((statement) => statement.declarationList.declarations)
    .find((candidate) => ts.isIdentifier(candidate.name) && candidate.name.text === name);
  return declaration?.initializer === undefined ? null : declaration.initializer;
}

function pathScope(statements: readonly ts.Statement[]): PathScope {
  const constants = new Map<string, ts.Expression>();
  const helpers = new Map<string, ts.Expression>();
  for (const statement of statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && isPathLike(declaration.initializer)) {
          constants.set(declaration.name.text, declaration.initializer);
        }
      }
    }
    if (ts.isFunctionDeclaration(statement) && statement.name !== undefined) {
      const returned = soleReturn(statement);
      if (returned !== null) {
        helpers.set(statement.name.text, returned);
      }
    }
  }
  return { constants, helpers };
}

function nestedDeclarations(body: ts.Block): ts.Statement[] {
  const statements: ts.Statement[] = [];
  visit(body, (node) => {
    if (ts.isVariableStatement(node) || ts.isFunctionDeclaration(node)) {
      statements.push(node);
    }
  });
  return statements;
}

function isPathLike(expression: ts.Expression | undefined): expression is ts.Expression {
  return (
    expression !== undefined &&
    (ts.isStringLiteral(expression) ||
      ts.isNoSubstitutionTemplateLiteral(expression) ||
      ts.isTemplateExpression(expression))
  );
}

function soleReturn(declaration: ts.FunctionDeclaration): ts.Expression | null {
  if (declaration.body === undefined) {
    return null;
  }
  const [only, ...rest] = declaration.body.statements;
  if (only === undefined || rest.length > 0 || !ts.isReturnStatement(only)) {
    return null;
  }
  return isPathLike(only.expression) ? only.expression : null;
}

function mergeScopes(...scopes: readonly PathScope[]): PathScope {
  const constants = new Map<string, ts.Expression>();
  const helpers = new Map<string, ts.Expression>();
  for (const scope of scopes) {
    for (const [name, constant] of scope.constants) {
      constants.set(name, constant);
    }
    for (const [name, helper] of scope.helpers) {
      helpers.set(name, helper);
    }
  }
  return { constants, helpers };
}

function optionWith(argument: ts.Node | undefined, option: string): ts.Expression | null {
  if (argument === undefined || !ts.isObjectLiteralExpression(argument)) {
    return null;
  }
  for (const property of argument.properties) {
    if (property.name?.getText() !== option) {
      continue;
    }
    if (ts.isPropertyAssignment(property)) {
      return property.initializer;
    }
    if (ts.isShorthandPropertyAssignment(property)) {
      return property.name;
    }
  }
  return null;
}

function methodOf(options: ts.Node | undefined, key: MethodKey): HttpMethod {
  const method = optionWith(options, METHOD_OPTION);
  if (method === null) {
    return DEFAULT_METHOD;
  }
  if (!ts.isStringLiteral(method) || !isHttpMethod(method.text)) {
    throw new Error(`${key}: cannot read the HTTP method ${method.getText()}`);
  }
  return method.text;
}

function resolvePath(expression: ts.Expression, scope: PathScope): string | null {
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    return expression.text;
  }
  if (ts.isIdentifier(expression)) {
    const constant = scope.constants.get(expression.text);
    return constant === undefined ? null : resolvePath(constant, scope);
  }
  if (ts.isCallExpression(expression) && ts.isIdentifier(expression.expression)) {
    const helper = scope.helpers.get(expression.expression.text);
    return helper === undefined ? null : resolvePath(helper, scope);
  }
  if (ts.isTemplateExpression(expression)) {
    const spans = expression.templateSpans.map((span) => {
      const piece = resolvePath(span.expression, scope);
      return `${piece === null ? PATH_PARAMETER : piece}${span.literal.text}`;
    });
    return `${expression.head.text}${spans.join("")}`;
  }
  return null;
}

function visit(node: ts.Node, visitor: (node: ts.Node) => void): void {
  visitor(node);
  ts.forEachChild(node, (child) => visit(child, visitor));
}
