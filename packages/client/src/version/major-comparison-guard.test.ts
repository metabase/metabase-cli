import { readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..", "..");
const SOURCE_ROOTS = ["packages/client/src", "packages/cli/src", "tests/e2e"];

// A parsed major on either side of a comparison, reached by property or already destructured.
const COMPARISON = "(<=|>=|===|!==|<|>)";
const MAJOR_COMPARISON = new RegExp(
  `\\bmajor\\s*${COMPARISON}|${COMPARISON}\\s*[\\w$.]*\\bmajor\\b`,
);

const GUARD = "packages/client/src/version/major-comparison-guard.test.ts";

// The files that turn a version into a decision. Everything else asks `features`.
const EVALUATORS: ReadonlySet<string> = new Set([
  "packages/client/src/version/features.ts",
  "packages/client/src/version/features.test.ts",
  "packages/client/src/version/profile.ts",
  "packages/client/src/version/profile.test.ts",
  "packages/client/src/version/tag.ts",
]);

function sourceFiles(roots: readonly string[]): string[] {
  return roots.flatMap((root) =>
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

describe("Metabase majors are compared in one place", () => {
  it("no source outside the version evaluators compares a parsed major", () => {
    const hits = sourceFiles(SOURCE_ROOTS)
      .filter((file) => !mayCompareMajors(file))
      .flatMap((file) => offendingLines(file, MAJOR_COMPARISON));
    expect(hits).toEqual([]);
  });

  it("every allowlisted file still exists", () => {
    const existing = new Set(sourceFiles(SOURCE_ROOTS));
    const stale = [...EVALUATORS].filter((file) => !existing.has(file));
    expect(stale).toEqual([]);
  });
});
