import { readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { isMethodKey, type MethodKey } from "@metabase/client/version/requirements";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_SRC = resolve(HERE, "..");

// A call on a client namespace, wherever the client came from: `client.card.list(`,
// `mb.gitSync.branch(`. Filtering the match through the requirements table drops everything that
// merely looks like one.
const METHOD_CALL = /\b[A-Za-z_$][\w$]*\.([A-Za-z]+)\.([A-Za-z]+)\(/g;
const REQUIRES_DECLARATION = /^\s*requires: (null|\[[^\]]*\]),?$/m;
const STRING_LITERAL = /"([^"]+)"/g;

// Helpers a command hands its client to. The methods they call count as the command's, so a
// command declares what reaches the wire on its behalf rather than what its own body spells out.
const CLIENT_HELPERS: Readonly<Record<string, string>> = {
  preflightDashcardCardReferences: "commands/dashboard/preflight.ts",
  warnIfOutsideSyncScope: "commands/git-sync/sync-scope.ts",
  verifyAndProbe: "core/auth/verify.ts",
};

function commandFiles(): string[] {
  return readdirSync(HERE, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .filter((entry) => !entry.name.endsWith(".test.ts"))
    .map((entry) => relative(CLI_SRC, resolve(entry.parentPath, entry.name)).split(sep).join("/"))
    .filter((file) => readSource(file).includes("defineMetabaseCommand({"));
}

function readSource(file: string): string {
  return readFileSync(resolve(CLI_SRC, file), "utf8");
}

function methodsCalledIn(source: string): MethodKey[] {
  return [...source.matchAll(METHOD_CALL)]
    .map((match) => `${match[1]}.${match[2]}`)
    .filter(isMethodKey);
}

function methodsReachedBy(file: string): MethodKey[] {
  const source = readSource(file);
  const viaHelpers = Object.entries(CLIENT_HELPERS)
    .filter(([helper]) => new RegExp(`\\b${helper}\\(`).test(source))
    .flatMap(([, helperFile]) => methodsCalledIn(readSource(helperFile)));
  return [...new Set([...methodsCalledIn(source), ...viaHelpers])].toSorted();
}

interface Declaration {
  readonly file: string;
  readonly requires: readonly string[] | null;
}

function declarationOf(file: string): Declaration {
  const match = REQUIRES_DECLARATION.exec(readSource(file));
  if (match === null || match[1] === undefined) {
    throw new Error(`${file}: no \`requires\` declaration found`);
  }
  if (match[1] === "null") {
    return { file, requires: null };
  }
  const requires = [...match[1].matchAll(STRING_LITERAL)].flatMap((literal) =>
    literal[1] === undefined ? [] : [literal[1]],
  );
  return { file, requires: requires.toSorted() };
}

describe("every command declares exactly the client methods it reaches", () => {
  const declarations = commandFiles().map(declarationOf);

  it("declares the methods called in its body and in the helpers it hands the client to", () => {
    const online = declarations.filter((declaration) => declaration.requires !== null);
    const declared = Object.fromEntries(online.map((entry) => [entry.file, entry.requires]));
    const reached = Object.fromEntries(
      online.map((entry) => [entry.file, methodsReachedBy(entry.file)]),
    );
    expect(declared).toEqual(reached);
  });

  it("reaches no client method at all when it declares it never reaches a server", () => {
    const offline = declarations.filter((declaration) => declaration.requires === null);
    const reached = Object.fromEntries(
      offline.map((entry) => [entry.file, methodsReachedBy(entry.file)]),
    );
    expect(reached).toEqual(Object.fromEntries(offline.map((entry) => [entry.file, []])));
  });

  it("names only helpers that still exist and still call a client method", () => {
    const reached = Object.fromEntries(
      Object.values(CLIENT_HELPERS).map((file) => [file, methodsCalledIn(readSource(file))]),
    );
    expect(reached).toEqual({
      "commands/dashboard/preflight.ts": ["dashboard.checkCardReferences"],
      "commands/git-sync/sync-scope.ts": ["gitSync.remoteUrl"],
      "core/auth/verify.ts": ["user.current"],
    });
  });
});
