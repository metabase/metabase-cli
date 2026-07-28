import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SRC_ROOT = resolve(fileURLToPath(import.meta.url), "..");

const DEPENDENCY_BUDGET = ["zod", "semver"];

interface SourceFile {
  relPath: string;
  content: string;
}

type RuleScope = "all" | "domain";

interface StructureRule {
  description: string;
  pattern: RegExp;
  allowedIn: string[];
  scope: RuleScope;
}

const RULES: StructureRule[] = [
  {
    description: "JSON.parse must only appear in src/json.ts",
    pattern: /JSON\.parse\(/,
    allowedIn: ["json.ts"],
    scope: "all",
  },
  {
    description: "direct fetch calls must only appear in src/http/",
    pattern: /\bfetch\s*\(|globalThis\.fetch/,
    allowedIn: ["http/"],
    scope: "all",
  },
  {
    description: "new URL() must only appear in src/url.ts or src/http/",
    pattern: /\bnew URL\(/,
    allowedIn: ["url.ts", "http/"],
    scope: "all",
  },
  {
    description: "wait loops must only appear in src/poll.ts or src/http/retry.ts",
    pattern: /setTimeout\([^)]*\bresolve\b|from\s+["']node:timers/,
    allowedIn: ["poll.ts", "http/retry.ts"],
    scope: "all",
  },
  {
    description: "the client must not touch process-global state",
    pattern: /\bprocess\.[A-Za-z]/,
    allowedIn: [],
    scope: "all",
  },
  {
    description: "node:tls is forbidden (TLS trust is the host application's to configure)",
    pattern: /["']node:tls["']/,
    allowedIn: [],
    scope: "all",
  },
  {
    description: "src/resources/ may only be imported by src/client.ts and its own siblings",
    pattern: /from\s+["'][./]*resources\//,
    allowedIn: ["client.ts", "resources/"],
    scope: "all",
  },
  {
    description: "import paths must not include the .ts extension",
    pattern: /from\s+["'][^"']+\.ts["']/,
    allowedIn: [],
    scope: "all",
  },
];

function listSourceFiles(): SourceFile[] {
  const out: SourceFile[] = [];
  function walk(dir: string): void {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!name.endsWith(".ts")) {
        continue;
      }
      if (name.endsWith(".test.ts")) {
        continue;
      }
      const relPath = relative(SRC_ROOT, full).split(sep).join("/");
      out.push({ relPath, content: readFileSync(full, "utf8") });
    }
  }
  walk(SRC_ROOT);
  return out;
}

function isAllowed(relPath: string, allowedIn: string[]): boolean {
  return allowedIn.some((entry) =>
    entry.endsWith("/") ? relPath.startsWith(entry) : relPath === entry,
  );
}

function inScope(relPath: string, scope: RuleScope): boolean {
  if (scope === "domain") {
    return relPath.startsWith("domain/");
  }
  return true;
}

function bareSpecifiers(content: string): string[] {
  const specifiers: string[] = [];
  for (const match of content.matchAll(/from\s+["']([^"']+)["']/g)) {
    const specifier = match[1];
    if (specifier === undefined || specifier.startsWith(".")) {
      continue;
    }
    specifiers.push(specifier);
  }
  return specifiers;
}

function withinBudget(specifier: string): boolean {
  if (specifier.startsWith("node:")) {
    return true;
  }
  return DEPENDENCY_BUDGET.some((pkg) => specifier === pkg || specifier.startsWith(`${pkg}/`));
}

function unstrippedPicks(content: string): number[] {
  const offsets: number[] = [];
  let cursor = content.indexOf(".pick(");
  while (cursor !== -1) {
    let depth = 0;
    let index = cursor + ".pick".length;
    for (; index < content.length; index++) {
      if (content[index] === "(") {
        depth++;
      } else if (content[index] === ")") {
        depth--;
        if (depth === 0) {
          index++;
          break;
        }
      }
    }
    if (!/^\s*\.strip\(\)/.test(content.slice(index))) {
      offsets.push(cursor);
    }
    cursor = content.indexOf(".pick(", index);
  }
  return offsets;
}

function lineOf(content: string, offset: number): number {
  return content.slice(0, offset).split("\n").length;
}

describe("layering policy", () => {
  const files = listSourceFiles();

  it("walks the client source tree", () => {
    const roots = files.filter((file) => !file.relPath.includes("/")).map((file) => file.relPath);
    expect(roots.toSorted()).toEqual([
      "client.ts",
      "errors.ts",
      "index.ts",
      "json-pointer.ts",
      "json.ts",
      "list.ts",
      "paginate.ts",
      "poll.ts",
      "predicates.ts",
      "signal.ts",
      "url.ts",
    ]);
  });

  for (const rule of RULES) {
    it(rule.description, () => {
      const offenders = files
        .filter((file) => inScope(file.relPath, rule.scope))
        .filter((file) => !isAllowed(file.relPath, rule.allowedIn))
        .filter((file) => rule.pattern.test(file.content))
        .map((file) => file.relPath);
      expect(offenders).toEqual([]);
    });
  }

  it("imports nothing beyond zod, semver and node: builtins", () => {
    const offenders = files.flatMap((file) =>
      bareSpecifiers(file.content)
        .filter((specifier) => !withinBudget(specifier))
        .map((specifier) => `${file.relPath}: ${specifier}`),
    );
    expect(offenders).toEqual([]);
  });

  it("every .pick() in src/domain/ chains .strip()", () => {
    const offenders = files
      .filter((file) => inScope(file.relPath, "domain"))
      .flatMap((file) =>
        unstrippedPicks(file.content).map(
          (offset) => `${file.relPath}:${lineOf(file.content, offset)}`,
        ),
      );
    expect(offenders).toEqual([]);
  });
});
