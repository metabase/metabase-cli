import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { Git, gitText, nulFields } from "./main/git/service";
import { runCommand, startProcess } from "./main/process/spawn";
import { TYPE_SCALE } from "./renderer/cn";

const SRC_ROOT = resolve(fileURLToPath(import.meta.url), "..");

const REPO_ROOT = resolve(SRC_ROOT, "..", "..", "..");

// Spelled so that this line does not match itself.
const REFERENCE_PROJECT_NAME = /t3 ?(?:code|tools)|beautiful.?ui/i;

interface SourceFile {
  relPath: string;
  content: string;
}

type RuleScope = "all" | "renderer";

interface StructureRule {
  description: string;
  pattern: RegExp;
  allowedIn: string[];
  scope: RuleScope;
}

const RULES: StructureRule[] = [
  {
    description: "ipcRenderer must only appear in the preload",
    pattern: /\bipcRenderer\b/,
    allowedIn: ["preload/index.ts"],
    scope: "all",
  },
  {
    description: "window.rde must only appear in the renderer's bridge",
    pattern: /window\.rde\b/,
    allowedIn: ["renderer/bridge.ts"],
    scope: "all",
  },
  {
    description: "Electron's IPC registrar must only appear in the composition root",
    pattern: /\bipcMain\b/,
    allowedIn: ["main/index.ts"],
    scope: "all",
  },
  {
    description: "the renderer must not import electron",
    pattern: /from\s+["']electron["']/,
    allowedIn: [],
    scope: "renderer",
  },
  {
    description: "the renderer must not import a node: builtin",
    pattern: /from\s+["']node:/,
    allowedIn: [],
    scope: "renderer",
  },
  {
    description: "child_process must only appear in main/process/spawn.ts",
    pattern: /child_process/,
    allowedIn: ["main/process/spawn.ts"],
    scope: "all",
  },
  {
    description: "the safeStorage API must only be called from main/auth/secret.ts",
    pattern: /\bsafeStorage\s*\./,
    allowedIn: ["main/auth/secret.ts"],
    scope: "all",
  },
  {
    description: "the folder picker must only appear in the composition root",
    pattern: /showOpenDialog/,
    allowedIn: ["main/index.ts"],
    scope: "all",
  },
  {
    description: "the app must not name an /api/ path literal",
    pattern: /["'`][^"'`]*\/api\//,
    allowedIn: [],
    scope: "all",
  },
  {
    description: "JSON.parse is forbidden (the client's parseJson owns it)",
    pattern: /JSON\.parse\(/,
    allowedIn: [],
    scope: "all",
  },
  {
    description: "provider names must only appear in the contracts and under main/providers/",
    pattern: /["'](?:claude|codex)["']/,
    allowedIn: ["contracts/providers.ts", "contracts/events.fixtures.ts", "main/providers/"],
    scope: "all",
  },
  {
    description: "Record<string, unknown> must not cross a contract",
    pattern: /Record<\s*string\s*,\s*unknown\s*>/,
    allowedIn: [],
    scope: "all",
  },
  {
    description: "a provider SDK must only be imported under its own provider directory",
    pattern: /@anthropic-ai\/claude-agent-sdk/,
    allowedIn: ["main/providers/claude/"],
    scope: "all",
  },
  {
    description: "a git invocation must go through main/git/service.ts",
    pattern: /["']git["']/,
    allowedIn: ["main/git/service.ts"],
    scope: "all",
  },
  {
    description: "the session log's own file name belongs to main/sessions/log.ts",
    pattern: /events\.jsonl/,
    allowedIn: ["main/sessions/log.ts"],
    scope: "all",
  },
  {
    description: "a renderer file must not project events outside the shared projector",
    pattern: /applyEvent|projectSession/,
    allowedIn: ["renderer/sessions.ts"],
    scope: "renderer",
  },
  {
    description: "an arbitrary length or size belongs to the primitives in components/ui/",
    pattern:
      /\b(?:text|w|h|size|p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap|rounded|leading|top|bottom|left|right|min-w|max-w|min-h|max-h|inset|translate-x|translate-y)-\[/,
    allowedIn: ["renderer/components/ui/"],
    scope: "renderer",
  },
  {
    description: "a text size is a step of the type scale in tokens.css",
    pattern: /\btext-(?:xs|sm|base|lg|[2-9]?xl)\b/,
    allowedIn: [],
    scope: "renderer",
  },
  {
    description: "a font size handed to a shadow root reads the type scale",
    pattern: /font-size[\w-]*:\s*\d/,
    allowedIn: [],
    scope: "renderer",
  },
  {
    description:
      "a bare form control belongs to the primitives in components/ui/ and components/agent/",
    pattern: /<(?:button|input|select|textarea)\b/,
    allowedIn: ["renderer/components/ui/", "renderer/components/agent/"],
    scope: "renderer",
  },
  {
    description: "a colour is a token, never a hex literal",
    pattern: /#[0-9a-fA-F]{3,8}\b/,
    allowedIn: [],
    scope: "renderer",
  },
  {
    description: "the virtualised list belongs to the timeline that owns the scroll",
    pattern: /@legendapp\/list/,
    allowedIn: ["renderer/components/Timeline/index.tsx"],
    scope: "all",
  },
  {
    description: "Markdown is parsed in one place",
    pattern: /react-markdown|remark-gfm|rehype-sanitize/,
    allowedIn: ["renderer/components/Timeline/Markdown.tsx"],
    scope: "all",
  },
  {
    description: "Electron's shell is imported only in the composition root",
    pattern: /import\s*{[^}]*\bshell\b[^}]*}\s*from\s*["']electron["']/,
    allowedIn: ["main/index.ts"],
    scope: "all",
  },
  {
    description: "electron-updater is imported only in the composition root",
    pattern: /from\s*["']electron-updater["']/,
    allowedIn: ["main/index.ts"],
    scope: "all",
  },
  {
    description: "a diff is rendered in one place",
    pattern: /@pierre\/diffs/,
    allowedIn: ["renderer/components/Changes/DiffViewer.tsx"],
    scope: "all",
  },
  {
    description: "the changed-file tree is rendered in one place",
    pattern: /@pierre\/trees/,
    allowedIn: ["renderer/components/Changes/FileTree.tsx"],
    scope: "all",
  },
  {
    description: "the bundled CLI is located in one place",
    pattern: /cli\.mjs|ELECTRON_RUN_AS_NODE/,
    allowedIn: ["main/cli/paths.ts"],
    scope: "all",
  },
  {
    description: "the window's title bar is decided in main/window.ts",
    pattern: /titleBarStyle|titleBarOverlay|TitleBarOverlay|trafficLightPosition/,
    allowedIn: ["main/window.ts"],
    scope: "all",
  },
  {
    description: "a drag region is a WindowStrip, styled in chrome.css",
    pattern: /app-region/,
    allowedIn: [],
    scope: "renderer",
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
      if (!name.endsWith(".ts") && !name.endsWith(".tsx")) {
        continue;
      }
      if (name.endsWith(".test.ts") || name.endsWith(".test.tsx")) {
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
  if (scope === "renderer") {
    return relPath.startsWith("renderer/");
  }
  return true;
}

describe("layering policy", () => {
  const files = listSourceFiles();

  it("walks the desktop source tree", () => {
    const roots = [...new Set(files.map((file) => file.relPath.split("/")[0]))];
    expect(roots.toSorted()).toEqual(["contracts", "main", "preload", "renderer"]);
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
});

describe("the type scale", () => {
  it("is the set of text sizes tokens.css declares, which the class merge knows", () => {
    const tokens = readFileSync(join(SRC_ROOT, "renderer", "tokens.css"), "utf8");
    const declared = [...tokens.matchAll(/^\s*--text-([a-z]+):/gm)].map((match) => match[1]);
    expect(declared).toEqual([...TYPE_SCALE]);
  });
});

describe("the reference projects", () => {
  it("are named by no file in the repository, in its path or its content", async () => {
    const git = new Git({
      env: process.env,
      run: runCommand,
      start: startProcess,
      signal: new AbortController().signal,
    });
    const listed = await git.read(REPO_ROOT, [
      "ls-files",
      "-z",
      "--cached",
      "--others",
      "--exclude-standard",
      "--deduplicate",
    ]);
    const present = nulFields(gitText(listed)).filter((path) => existsSync(join(REPO_ROOT, path)));
    const offenders = present.filter(
      (path) =>
        REFERENCE_PROJECT_NAME.test(path) ||
        REFERENCE_PROJECT_NAME.test(readFileSync(join(REPO_ROOT, path), "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});
