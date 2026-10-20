import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

import type { HttpMethod } from "@metabase/client/http/transport";
import { isHttpMethod } from "@metabase/client/version/openapi-drift";
import { isMethodKey, type MethodKey } from "@metabase/client/version/requirements";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLIENT_SRC = resolve(HERE, "..", "..", "packages", "client", "src");
const CLIENT_ENTRY = "client.ts";
const SOURCE_EXTENSION = ".ts";

const API_PREFIX = "/api/";
const INPUT_SUFFIX = "Input";
const RESOURCE_SUFFIX = "Resource";
const BODY_OPTION = "body";
const METHOD_OPTION = "method";
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

export interface InputPairing {
  readonly key: MethodKey;
  readonly input: string;
  readonly request: BodyRequest | null;
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

export function scanInputPairings(): InputPairing[] {
  return resourceNamespaces().flatMap(pairingsOf);
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

function pairingsOf({ namespace, factory, file }: ResourceNamespace): InputPairing[] {
  const source = parseSource(file);
  const definition = source.statements.find(
    (statement): statement is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(statement) && statement.name?.text === factory,
  );
  if (definition?.body === undefined) {
    throw new Error(`${file}: no function ${factory}`);
  }
  const factoryBody = definition.body;
  const functions = localFunctions(factoryBody.statements);
  const surface = returnedObject(factoryBody, file);
  const fileScope = pathScope(source.statements);
  const factoryScope = pathScope(factoryBody.statements);

  return surface.properties.flatMap((property) => {
    if (property.name === undefined) {
      throw new Error(`${file}: ${namespace} spreads a property the scan cannot name`);
    }
    const key = `${namespace}.${property.name.getText()}`;
    if (!isMethodKey(key)) {
      throw new Error(`${file}: ${key} is not a method key`);
    }
    const implementation = functions.get(implementingFunction(property, key));
    if (implementation?.body === undefined) {
      throw new Error(`${file}: ${key} names no function declared in ${factory}`);
    }
    const input = inputTypeOf(implementation, key);
    if (input === null) {
      return [];
    }
    const methodScope = pathScope(nestedDeclarations(implementation.body));
    const scope = mergeScopes(fileScope, factoryScope, methodScope);
    return [{ key, input, request: bodyRequestOf(implementation.body, scope, key) }];
  });
}

function localFunctions(
  statements: ts.NodeArray<ts.Statement>,
): Map<string, ts.FunctionDeclaration> {
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

function inputTypeOf(implementation: ts.FunctionDeclaration, key: MethodKey): string | null {
  const inputs = implementation.parameters.flatMap((parameter) => {
    const type = parameter.type;
    if (type === undefined || !ts.isTypeReferenceNode(type)) {
      return [];
    }
    const name = type.typeName.getText();
    return name.endsWith(INPUT_SUFFIX) ? [name] : [];
  });
  const [input, ...others] = inputs;
  if (others.length > 0) {
    throw new Error(`${key}: takes more than one input (${inputs.join(", ")})`);
  }
  return input === undefined ? null : input;
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

function bodyRequestOf(body: ts.Block, scope: PathScope, key: MethodKey): BodyRequest | null {
  const calls: ts.CallExpression[] = [];
  visit(body, (node) => {
    if (
      ts.isCallExpression(node) &&
      node.arguments.some((argument) => optionWith(argument, BODY_OPTION))
    ) {
      calls.push(node);
    }
  });
  const [call, ...others] = calls;
  if (call === undefined) {
    return null;
  }
  if (others.length > 0) {
    throw new Error(`${key}: sends more than one body`);
  }
  const options = call.arguments.find((argument) => optionWith(argument, BODY_OPTION));
  const paths = call.arguments.flatMap((argument) => {
    const path = argument === options ? null : resolvePath(argument, scope);
    return path !== null && path.startsWith(API_PREFIX) ? [path] : [];
  });
  const [path, ...otherPaths] = paths;
  if (path === undefined || otherPaths.length > 0) {
    throw new Error(`${key}: cannot tell which path ${call.getText()} sends its body to`);
  }
  return { method: methodOf(options, key), path };
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
