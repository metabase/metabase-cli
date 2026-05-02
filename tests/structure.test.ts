import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SRC_ROOT = resolve(fileURLToPath(import.meta.url), "..", "..", "src");

interface SourceFile {
  relPath: string;
  content: string;
}

type RuleScope = "all" | "commands" | "output";

interface StructureRule {
  description: string;
  pattern: RegExp;
  allowedIn: string[];
  scope: RuleScope;
}

const RULES: StructureRule[] = [
  {
    description: "process.exit() must only appear in src/cli.ts",
    pattern: /process\.exit\(/,
    allowedIn: ["cli.ts"],
    scope: "all",
  },
  {
    description: "process.stderr.write must only appear in src/cli.ts or src/output/",
    pattern: /process\.stderr\.write/,
    allowedIn: ["cli.ts", "output/"],
    scope: "all",
  },
  {
    description: "process.stdout.write must only appear in src/output/",
    pattern: /process\.stdout\.write/,
    allowedIn: ["output/"],
    scope: "all",
  },
  {
    description: "wait loops (setTimeout(...resolve)) must only appear in src/runtime/poll.ts",
    pattern: /setTimeout\([^)]*\bresolve\b/,
    allowedIn: ["runtime/poll.ts"],
    scope: "all",
  },
  {
    description: "child_process import/use must only appear in src/runtime/process.ts",
    pattern: /child_process\.spawn|from\s+["']node:child_process["']/,
    allowedIn: ["runtime/process.ts"],
    scope: "all",
  },
  {
    description: "JSON.parse must only appear in src/runtime/json.ts",
    pattern: /JSON\.parse\(/,
    allowedIn: ["runtime/json.ts"],
    scope: "all",
  },
  {
    description: "direct fetch calls must only appear in src/core/http/",
    pattern: /\bfetch\s*\(|globalThis\.fetch/,
    allowedIn: ["core/http/"],
    scope: "all",
  },
  {
    description: "new URL() must only appear in src/core/http/ or src/core/url.ts",
    pattern: /\bnew URL\(/,
    allowedIn: ["core/http/", "core/url.ts"],
    scope: "all",
  },
  {
    description: "Record<string, unknown> is forbidden in command files",
    pattern: /Record<\s*string\s*,\s*unknown\s*>/,
    allowedIn: [],
    scope: "commands",
  },
  {
    description: "src/output/ must not import from src/core/http/ (use src/core/errors)",
    pattern: /from\s+["'][./]+core\/http\b/,
    allowedIn: [],
    scope: "output",
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
  if (scope === "commands") {
    return relPath.startsWith("commands/");
  }
  if (scope === "output") {
    return relPath.startsWith("output/");
  }
  return true;
}

describe("layering policy", () => {
  const files = listSourceFiles();

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
});
