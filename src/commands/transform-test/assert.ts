import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";

import { ConfigError, errorMessage, isNotFoundError } from "../../core/errors";

export type Severity = "error" | "warn";

export interface AssertionDef {
  name: string;
  sql: string;
  severity: Severity;
}

// An --assert value is a `.sql` file or a glob of them; inline SQL is not supported.
export type AssertToken = { kind: "file"; path: string } | { kind: "glob"; pattern: string };

// basename with `*` ⇒ glob; plain `.sql` ⇒ file; anything else rejected.
export function classifyAssertToken(token: string): AssertToken {
  if (/\.sql$/i.test(token)) {
    return basename(token).includes("*")
      ? { kind: "glob", pattern: token }
      : { kind: "file", path: token };
  }
  throw new ConfigError(
    `--assert expects a .sql file path or glob (inline SQL is not supported); got: "${token}"`,
  );
}

// `--assert` is repeatable (citty hands back a string[] when given more than once) and each
// value may itself be comma-separated (file/glob paths).
export function parseAssertFlags(value: string | string[] | undefined): AssertToken[] {
  if (value === undefined) {
    return [];
  }
  const raw = Array.isArray(value) ? value : [value];
  const tokens: AssertToken[] = [];
  for (const entry of raw) {
    if (entry.trim() === "") {
      continue;
    }
    for (const part of entry.split(",")) {
      const trimmed = part.trim();
      if (trimmed !== "") {
        tokens.push(classifyAssertToken(trimmed));
      }
    }
  }
  return tokens;
}

function assertionName(path: string): string {
  return basename(path, extname(path));
}

export async function readSqlFile(path: string, label: string): Promise<string> {
  try {
    const contents = await readFile(path, "utf8");
    return contents.trim();
  } catch (error) {
    throw new ConfigError(`Cannot read ${label} '${path}': ${errorMessage(error)}`);
  }
}

// A glob here is shallow: a single directory listing filtered by the literal
// prefix/suffix around the one `*` in the basename. Enough for the documented `dir/*.sql`
// form without pulling in a glob dependency; nested `**` is not supported.
async function expandGlob(pattern: string): Promise<string[]> {
  const dir = dirname(pattern);
  const base = basename(pattern);
  const star = base.indexOf("*");
  const prefix = base.slice(0, star);
  const suffix = base.slice(star + 1);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (error) {
    if (isNotFoundError(error)) {
      throw new ConfigError(`--assert glob '${pattern}' matched nothing (no such directory).`);
    }
    throw new ConfigError(`Cannot read --assert glob '${pattern}': ${errorMessage(error)}`);
  }
  const matches = entries
    .filter(
      (name) => name.startsWith(prefix) && name.endsWith(suffix) && name.length >= base.length - 1,
    )
    .toSorted()
    .map((name) => join(dir, name));
  if (matches.length === 0) {
    throw new ConfigError(`--assert glob '${pattern}' matched no files.`);
  }
  return matches;
}

// Each `.sql` file → one assertion, named by basename without extension; severity defaults to error.
export async function resolveAssertions(tokens: AssertToken[]): Promise<AssertionDef[]> {
  const out: AssertionDef[] = [];
  for (const token of tokens) {
    const paths = token.kind === "glob" ? await expandGlob(token.pattern) : [token.path];
    for (const path of paths) {
      out.push({
        name: assertionName(path),
        sql: await readSqlFile(path, "--assert file"),
        severity: "error",
      });
    }
  }
  return out;
}
