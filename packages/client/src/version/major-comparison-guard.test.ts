import { readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..", "..");
const SOURCE_ROOTS = ["packages/client/src", "packages/cli/src"];

const MAJOR_COMPARISON = /\.major\s*(<=|>=|===|!==|<|>)/;
const MIN_VERSION = /\bminVersion\b/;

const GUARD = "packages/client/src/version/major-comparison-guard.test.ts";

// The files that turn a version into a decision. Everything else asks `features`.
const EVALUATORS: ReadonlySet<string> = new Set([
  "packages/client/src/version/features.ts",
  "packages/client/src/version/features.test.ts",
  "packages/client/src/version/profile.ts",
  "packages/client/src/version/profile.test.ts",
  "packages/client/src/version/tag.ts",
]);

// A single server floor is a summary the version layer derives from features for consumers that
// want one number; nothing outside it may declare one.
const VERSION_DIR = "packages/client/src/version/";

function sourceFiles(): string[] {
  return SOURCE_ROOTS.flatMap((root) =>
    readdirSync(resolve(REPO_ROOT, root), { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
      .map((entry) =>
        relative(REPO_ROOT, resolve(entry.parentPath, entry.name)).split(sep).join("/"),
      )
      .filter((file) => file !== GUARD),
  );
}

function offendingLines(file: string, pattern: RegExp): string[] {
  return readFileSync(resolve(REPO_ROOT, file), "utf8")
    .split("\n")
    .flatMap((line, index) => (pattern.test(line) ? [`${file}:${index + 1}: ${line.trim()}`] : []));
}

function mayCompareMajors(file: string): boolean {
  return EVALUATORS.has(file);
}

function mayDeclareMinVersion(file: string): boolean {
  return file.startsWith(VERSION_DIR);
}

describe("Metabase majors are compared in one place", () => {
  it("no source outside the version evaluators compares a parsed major", () => {
    const hits = sourceFiles()
      .filter((file) => !mayCompareMajors(file))
      .flatMap((file) => offendingLines(file, MAJOR_COMPARISON));
    expect(hits).toEqual([]);
  });

  it("no source outside the version layer names a minVersion", () => {
    const hits = sourceFiles()
      .filter((file) => !mayDeclareMinVersion(file))
      .flatMap((file) => offendingLines(file, MIN_VERSION));
    expect(hits).toEqual([]);
  });

  it("every allowlisted file still exists, so a deleted file leaves no stale exemption", () => {
    const existing = new Set(sourceFiles());
    const stale = [...EVALUATORS].filter((file) => !existing.has(file));
    expect(stale).toEqual([]);
  });
});
