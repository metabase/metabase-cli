import { delimiter, join } from "node:path";

const CLI_RESOURCE_DIR = "rde-cli";
const CLI_ENTRY_SEGMENTS = ["dist", "cli.mjs"] as const;
const SKILLS_DIR = "skill-data";
const BIN_DIR = "bin";
const DEV_CLI_PACKAGE_SEGMENTS = ["..", "..", "cli"] as const;
const DEV_RESOURCES_SEGMENTS = ["..", "resources"] as const;
const ICON_FILE = "icon.png";
const DEV_ICON_SEGMENTS = ["..", "build", ICON_FILE] as const;

export const RDE_NODE_ENV_VAR = "RDE_NODE";
export const RDE_CLI_ENV_VAR = "RDE_CLI";
export const SKILLS_DIR_ENV_VAR = "MB_SKILLS_DIR";
export const RUN_AS_NODE_ENV_VAR = "ELECTRON_RUN_AS_NODE";
export const RUN_AS_NODE = "1";

// `outDir` is the build's `out/`, which sits in the desktop package beside the CLI's package.
interface DevLayout {
  readonly kind: "dev";
  readonly outDir: string;
}

interface PackagedLayout {
  readonly kind: "packaged";
  readonly resourcesPath: string;
}

export type AppLayout = DevLayout | PackagedLayout;

// `node` is the executable that runs `entry`: the app's own, as Node, so the CLI runs on the Node
// the app was built with rather than whichever one the user has.
export interface CliLocation {
  readonly node: string;
  readonly entry: string;
  readonly skills: string;
  readonly bin: string;
}

export function cliLocation(layout: AppLayout, node: string): CliLocation {
  if (layout.kind === "packaged") {
    const root = join(layout.resourcesPath, CLI_RESOURCE_DIR);
    return {
      node,
      entry: join(root, ...CLI_ENTRY_SEGMENTS),
      skills: join(root, SKILLS_DIR),
      bin: join(root, BIN_DIR),
    };
  }
  const cliPackage = join(layout.outDir, ...DEV_CLI_PACKAGE_SEGMENTS);
  return {
    node,
    entry: join(cliPackage, ...CLI_ENTRY_SEGMENTS),
    skills: join(cliPackage, SKILLS_DIR),
    bin: join(layout.outDir, ...DEV_RESOURCES_SEGMENTS, CLI_RESOURCE_DIR, BIN_DIR),
  };
}

export interface CliEnvironment {
  readonly PATH: string;
  readonly [SKILLS_DIR_ENV_VAR]: string;
  readonly [RDE_NODE_ENV_VAR]: string;
  readonly [RDE_CLI_ENV_VAR]: string;
}

// The shim is first on `PATH`, so the `mb` an agent runs is the app's even when the user has
// another one installed.
export function cliEnvironment(location: CliLocation, path: string): CliEnvironment {
  return {
    PATH: `${location.bin}${delimiter}${path}`,
    [SKILLS_DIR_ENV_VAR]: location.skills,
    [RDE_NODE_ENV_VAR]: location.node,
    [RDE_CLI_ENV_VAR]: location.entry,
  };
}

// A packaged app carries `build/icon.png` among its resources; a dev run reads it from the package.
export function appIconPath(layout: AppLayout): string {
  if (layout.kind === "packaged") {
    return join(layout.resourcesPath, ICON_FILE);
  }
  return join(layout.outDir, ...DEV_ICON_SEGMENTS);
}
