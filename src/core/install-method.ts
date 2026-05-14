import { realpathSync } from "node:fs";

import { z } from "zod";

export const InstallMethodKindSchema = z.enum(["npm-global", "npm-local", "npx", "dev", "unknown"]);
export type InstallMethodKind = z.infer<typeof InstallMethodKindSchema>;

export const PackageManagerSchema = z.enum(["npm", "pnpm", "yarn", "bun", "unknown"]);
export type PackageManager = z.infer<typeof PackageManagerSchema>;

export interface InstallMethod {
  readonly kind: InstallMethodKind;
  readonly packageManager: PackageManager;
  readonly realPath: string;
}

export interface InstallCommand {
  readonly argv: readonly [string, ...string[]];
  readonly display: string;
}

interface GlobalMarker {
  readonly marker: string;
  readonly packageManager: PackageManager;
}

// Ordered most-specific first. Match against the path with forward-slash separators.
const GLOBAL_MARKERS: ReadonlyArray<GlobalMarker> = [
  { marker: "/.bun/install/global/node_modules/", packageManager: "bun" },
  { marker: "/Library/pnpm/global/", packageManager: "pnpm" },
  { marker: "/.local/share/pnpm/global/", packageManager: "pnpm" },
  { marker: "/share/pnpm/global/", packageManager: "pnpm" },
  { marker: "/AppData/Local/pnpm/global/", packageManager: "pnpm" },
  { marker: "/pnpm-global/node_modules/", packageManager: "pnpm" },
  { marker: "/.config/yarn/global/node_modules/", packageManager: "yarn" },
  { marker: "/AppData/Local/Yarn/Data/global/node_modules/", packageManager: "yarn" },
  { marker: "/lib/node_modules/", packageManager: "npm" },
  { marker: "/.npm-global/node_modules/", packageManager: "npm" },
  { marker: "/AppData/Roaming/npm/node_modules/", packageManager: "npm" },
];

const NPX_MARKER = "/_npx/";
const NODE_MODULES_MARKER = "/node_modules/";

export interface DetectInstallMethodOptions {
  npmConfigPrefix?: string;
}

export function detectInstallMethod(
  scriptPath: string | undefined,
  options: DetectInstallMethodOptions = {},
): InstallMethod {
  if (scriptPath === undefined || scriptPath === "") {
    return { kind: "unknown", packageManager: "unknown", realPath: "" };
  }
  const realPath = safeRealpath(scriptPath);
  const normalized = realPath.replaceAll("\\", "/");
  if (realPath.endsWith(".ts")) {
    return { kind: "dev", packageManager: "unknown", realPath };
  }
  if (normalized.includes(NPX_MARKER)) {
    return { kind: "npx", packageManager: "npm", realPath };
  }
  for (const { marker, packageManager } of GLOBAL_MARKERS) {
    if (normalized.includes(marker)) {
      return { kind: "npm-global", packageManager, realPath };
    }
  }
  const customPrefix = resolveNpmConfigPrefix(options.npmConfigPrefix);
  if (customPrefix !== null && normalized.startsWith(customPrefix)) {
    return { kind: "npm-global", packageManager: "npm", realPath };
  }
  if (normalized.includes(NODE_MODULES_MARKER)) {
    return { kind: "npm-local", packageManager: "npm", realPath };
  }
  return { kind: "dev", packageManager: "unknown", realPath };
}

function resolveNpmConfigPrefix(override: string | undefined): string | null {
  const raw = override ?? process.env["npm_config_prefix"] ?? process.env["NPM_CONFIG_PREFIX"];
  if (raw === undefined || raw === "") {
    return null;
  }
  const normalized = raw.replaceAll("\\", "/").replace(/\/+$/, "");
  return `${normalized}/`;
}

export function buildInstallCommand(
  install: InstallMethod,
  packageName: string,
  targetVersion: string,
): InstallCommand | null {
  const spec = `${packageName}@${targetVersion}`;
  switch (install.kind) {
    case "npm-global": {
      return makeCommand(globalArgv(install.packageManager, spec));
    }
    case "npm-local": {
      return makeCommand(["npm", "install", spec]);
    }
    case "npx":
    case "dev":
    case "unknown": {
      return null;
    }
  }
}

function globalArgv(packageManager: PackageManager, spec: string): [string, ...string[]] {
  switch (packageManager) {
    case "pnpm": {
      return ["pnpm", "add", "-g", spec];
    }
    case "yarn": {
      return ["yarn", "global", "add", spec];
    }
    case "bun": {
      return ["bun", "add", "-g", spec];
    }
    case "npm":
    case "unknown": {
      return ["npm", "install", "-g", spec];
    }
  }
}

function makeCommand(argv: [string, ...string[]]): InstallCommand {
  return { argv, display: argv.join(" ") };
}

function safeRealpath(path: string): string {
  try {
    return realpathSync(path);
  } catch (error) {
    if (error instanceof Error) {
      return path;
    }
    throw error;
  }
}
