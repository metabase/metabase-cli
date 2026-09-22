import { readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { isMethodKey, type MethodKey } from "@metabase/client/version/requirements";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_SRC = resolve(HERE, "..");

const COMMAND_DEFINER = "defineMetabaseCommand";
const REQUIRES_FIELD = "requires";
const CLIENT_GETTER = "getClient";
const CLIENT_TYPE = "MetabaseClient";

// Helpers a command hands its client to. The methods they call count as the command's, so a
// command declares what reaches the wire on its behalf rather than what its own body spells out.
const CLIENT_HELPERS: Readonly<Record<string, string>> = {
  preflightDashcardCardReferences: "commands/dashboard/preflight.ts",
  warnIfOutsideSyncScope: "commands/git-sync/sync-scope.ts",
  verifyAndProbe: "core/auth/verify.ts",
};

interface ParsedFile {
  readonly file: string;
  readonly source: ts.SourceFile;
}

interface CommandFile extends ParsedFile {
  readonly definition: ts.ObjectLiteralExpression;
}

function parseSource(file: string): ParsedFile {
  const text = readFileSync(resolve(CLI_SRC, file), "utf8");
  return { file, source: ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true) };
}

function sourceFiles(): ParsedFile[] {
  return readdirSync(CLI_SRC, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .filter((entry) => !entry.name.endsWith(".test.ts"))
    .map((entry) => relative(CLI_SRC, resolve(entry.parentPath, entry.name)).split(sep).join("/"))
    .toSorted()
    .map(parseSource);
}

const FILES = sourceFiles();

function descendantsOf(node: ts.Node): ts.Node[] {
  const found: ts.Node[] = [];
  const visit = (child: ts.Node): void => {
    found.push(child);
    ts.forEachChild(child, visit);
  };
  ts.forEachChild(node, visit);
  return found;
}

function isCallTo(node: ts.Node, callee: string): node is ts.CallExpression {
  return (
    ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === callee
  );
}

function commandDefinitionOf(parsed: ParsedFile): ts.ObjectLiteralExpression | null {
  const definer = descendantsOf(parsed.source).find((node) => isCallTo(node, COMMAND_DEFINER));
  if (definer === undefined) {
    return null;
  }
  const [definition] = definer.arguments;
  if (definition === undefined || !ts.isObjectLiteralExpression(definition)) {
    throw new Error(`${parsed.file}: ${COMMAND_DEFINER} takes an object literal`);
  }
  return definition;
}

function commandFiles(): CommandFile[] {
  return FILES.flatMap((parsed) => {
    const definition = commandDefinitionOf(parsed);
    return definition === null ? [] : [{ ...parsed, definition }];
  });
}

function parsedFile(file: string): ParsedFile {
  const parsed = FILES.find((candidate) => candidate.file === file);
  if (parsed === undefined) {
    throw new Error(`${file}: not a CLI source file`);
  }
  return parsed;
}

// Every non-command source file that reaches a client method, whether or not `CLIENT_HELPERS` names it.
function clientReachingHelpers(): string[] {
  return FILES.filter((parsed) => commandDefinitionOf(parsed) === null)
    .filter((parsed) => methodsCalledIn(parsed).length > 0)
    .map((parsed) => parsed.file);
}

// Any `x.ns.method(` call; filtering through the requirements table drops what merely looks like one.
function methodKeyOf(call: ts.CallExpression): MethodKey | null {
  const callee = call.expression;
  if (!ts.isPropertyAccessExpression(callee) || !ts.isPropertyAccessExpression(callee.expression)) {
    return null;
  }
  const key = `${callee.expression.name.text}.${callee.name.text}`;
  return isMethodKey(key) ? key : null;
}

function methodsCalledIn(parsed: ParsedFile): MethodKey[] {
  return descendantsOf(parsed.source)
    .filter(ts.isCallExpression)
    .flatMap((call) => {
      const key = methodKeyOf(call);
      return key === null ? [] : [key];
    });
}

function helpersCalledIn(parsed: ParsedFile): ParsedFile[] {
  const nodes = descendantsOf(parsed.source);
  return Object.entries(CLIENT_HELPERS)
    .filter(([helper]) => nodes.some((node) => isCallTo(node, helper)))
    .map(([, file]) => parsedFile(file));
}

function methodsReachedBy(parsed: ParsedFile): MethodKey[] {
  const viaHelpers = helpersCalledIn(parsed).flatMap(methodsCalledIn);
  return [...new Set([...methodsCalledIn(parsed), ...viaHelpers])].toSorted();
}

interface Declaration {
  readonly file: string;
  readonly requires: readonly string[] | null;
}

function isRequiresField(property: ts.ObjectLiteralElementLike): property is ts.PropertyAssignment {
  return (
    ts.isPropertyAssignment(property) &&
    ts.isIdentifier(property.name) &&
    property.name.text === REQUIRES_FIELD
  );
}

function declaredKeyOf(element: ts.Expression, file: string): string {
  if (!ts.isStringLiteral(element)) {
    throw new Error(
      `${file}: \`${REQUIRES_FIELD}\` lists \`${element.getText()}\`, not a string literal`,
    );
  }
  return element.text;
}

function declarationOf(command: CommandFile): Declaration {
  const { file } = command;
  const field = command.definition.properties.find(isRequiresField);
  if (field === undefined) {
    throw new Error(`${file}: no \`${REQUIRES_FIELD}\` declaration found`);
  }
  const { initializer } = field;
  if (initializer.kind === ts.SyntaxKind.NullKeyword) {
    return { file, requires: null };
  }
  if (!ts.isArrayLiteralExpression(initializer)) {
    throw new Error(`${file}: \`${REQUIRES_FIELD}\` is neither null nor an array literal`);
  }
  const requires = initializer.elements.map((element) => declaredKeyOf(element, file));
  return { file, requires: requires.toSorted() };
}

interface OnlineDeclaration {
  readonly file: string;
  readonly requires: readonly string[];
}

function onlineOnly(declarations: readonly Declaration[]): OnlineDeclaration[] {
  return declarations.flatMap(({ file, requires }) =>
    requires === null ? [] : [{ file, requires }],
  );
}

function isClientParameter(node: ts.Node): node is ts.ParameterDeclaration {
  return (
    ts.isParameter(node) &&
    node.type !== undefined &&
    ts.isTypeReferenceNode(node.type) &&
    ts.isIdentifier(node.type.typeName) &&
    node.type.typeName.text === CLIENT_TYPE
  );
}

function innermostValue(node: ts.Node): ts.Node {
  let current = node;
  while (ts.isAwaitExpression(current) || ts.isParenthesizedExpression(current)) {
    current = current.expression;
  }
  return current;
}

function outermostValue(node: ts.Node): ts.Node {
  let current = node;
  while (ts.isAwaitExpression(current.parent) || ts.isParenthesizedExpression(current.parent)) {
    current = current.parent;
  }
  return current;
}

interface ClientBinding extends ts.VariableDeclaration {
  readonly name: ts.Identifier;
}

function isClientBinding(node: ts.Node): node is ClientBinding {
  return (
    ts.isVariableDeclaration(node) &&
    ts.isIdentifier(node.name) &&
    node.initializer !== undefined &&
    isCallTo(innermostValue(node.initializer), CLIENT_GETTER)
  );
}

// The names a file reaches its client by: what `getClient()` was bound to and every parameter
// typed as the client. Resolved by name within the file, so a shadowing binding is refused too.
function clientNamesOf(nodes: readonly ts.Node[]): ReadonlySet<string> {
  const names = new Set<string>();
  for (const node of nodes) {
    if (isClientBinding(node)) {
      names.add(node.name.text);
    }
    if (isClientParameter(node) && ts.isIdentifier(node.name)) {
      names.add(node.name.text);
    }
  }
  return names;
}

function isDeclaringName(identifier: ts.Identifier): boolean {
  const { parent } = identifier;
  if (ts.isVariableDeclaration(parent) || ts.isParameter(parent)) {
    return parent.name === identifier;
  }
  if (ts.isPropertyAccessExpression(parent) || ts.isPropertyAssignment(parent)) {
    return parent.name === identifier;
  }
  return ts.isBindingElement(parent) && parent.propertyName === identifier;
}

function isClientReference(node: ts.Node, names: ReadonlySet<string>): node is ts.Identifier {
  return ts.isIdentifier(node) && names.has(node.text) && !isDeclaringName(node);
}

function isNamespaceMethodReceiver(value: ts.Node): boolean {
  const namespace = value.parent;
  if (!ts.isPropertyAccessExpression(namespace) || namespace.expression !== value) {
    return false;
  }
  const method = namespace.parent;
  if (!ts.isPropertyAccessExpression(method) || method.expression !== namespace) {
    return false;
  }
  const call = method.parent;
  return ts.isCallExpression(call) && call.expression === method;
}

function isClientHelperArgument(value: ts.Node): boolean {
  const call = value.parent;
  return (
    ts.isCallExpression(call) &&
    ts.isIdentifier(call.expression) &&
    Object.hasOwn(CLIENT_HELPERS, call.expression.text) &&
    call.arguments.some((argument) => argument === value)
  );
}

function isBoundToName(value: ts.Node): boolean {
  return isClientBinding(value.parent) && value.parent.initializer === value;
}

function describeMisuse(parsed: ParsedFile, node: ts.Node): string {
  const { line } = parsed.source.getLineAndCharacterOfPosition(node.getStart());
  return `${parsed.file}:${line + 1}: ${node.getText()}`;
}

function clientMisusesIn(parsed: ParsedFile): string[] {
  const nodes = descendantsOf(parsed.source);
  const names = clientNamesOf(nodes);
  return nodes.flatMap((node) => {
    if (isClientParameter(node) && !ts.isIdentifier(node.name)) {
      return [describeMisuse(parsed, node)];
    }
    if (isCallTo(node, CLIENT_GETTER)) {
      const value = outermostValue(node);
      const allowed =
        isBoundToName(value) || isNamespaceMethodReceiver(value) || isClientHelperArgument(value);
      return allowed ? [] : [describeMisuse(parsed, value.parent)];
    }
    if (isClientReference(node, names)) {
      const allowed = isNamespaceMethodReceiver(node) || isClientHelperArgument(node);
      return allowed ? [] : [describeMisuse(parsed, node.parent)];
    }
    return [];
  });
}

describe("every command declares exactly the client methods it reaches", () => {
  const commands = commandFiles();
  const declarations = commands.map(declarationOf);

  it("declares the methods called in its body and in the helpers it hands the client to", () => {
    const online = onlineOnly(declarations);
    const declared = Object.fromEntries(online.map((entry) => [entry.file, entry.requires]));
    const reached = Object.fromEntries(
      online.map((entry) => [entry.file, methodsReachedBy(parsedFile(entry.file))]),
    );
    expect(declared).toEqual(reached);
  });

  it("reaches no client method at all when it declares it never reaches a server", () => {
    const offline = declarations.filter((declaration) => declaration.requires === null);
    const reached = Object.fromEntries(
      offline.map((entry) => [entry.file, methodsReachedBy(parsedFile(entry.file))]),
    );
    expect(reached).toEqual(Object.fromEntries(offline.map((entry) => [entry.file, []])));
  });

  it("names every non-command file that reaches a client method", () => {
    expect(clientReachingHelpers()).toEqual(Object.values(CLIENT_HELPERS).toSorted());
  });

  it("names only helpers that still exist and still call a client method", () => {
    const reached = Object.fromEntries(
      Object.values(CLIENT_HELPERS).map((file) => [file, methodsCalledIn(parsedFile(file))]),
    );
    expect(reached).toEqual({
      "commands/dashboard/preflight.ts": ["dashboard.checkCardReferences"],
      "commands/git-sync/sync-scope.ts": ["gitSync.remoteUrl"],
      "core/auth/verify.ts": ["user.current"],
    });
  });

  it("uses a client value only as the receiver of a `ns.method(` call or as an argument to a client helper", () => {
    const helpers = Object.values(CLIENT_HELPERS).map(parsedFile);
    expect([...commands, ...helpers].flatMap(clientMisusesIn)).toEqual([]);
  });
});
