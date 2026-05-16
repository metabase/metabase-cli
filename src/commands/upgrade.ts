import { z } from "zod";

import packageJson from "../../package.json" with { type: "json" };
import { AbortError, UnknownError } from "../core/errors";
import { fetchNpmDistTags, type FetchDistTagsOptions } from "../core/http/npm-registry";
import {
  buildInstallCommand,
  detectInstallMethod,
  InstallMethodKindSchema,
  PackageManagerSchema,
  type InstallCommand,
  type InstallMethod,
} from "../core/install-method";
import { compareSemver, SemverString } from "../core/semver";
import type { ResourceView } from "../domain/view";
import { renderItem, writeText } from "../output/render";
import { promptConfirm } from "../output/prompt";
import type { RenderOptions } from "../output/types";
import { streamProcess } from "../runtime/process";

import { outputFlags } from "./flags";
import { defineMetabaseCommand } from "./runtime";

const UpgradeCommandSchema = z.object({
  argv: z.array(z.string()).min(1),
  display: z.string(),
});

export const UpgradeStatus = z.object({
  packageName: z.string(),
  currentVersion: SemverString,
  latestVersion: SemverString,
  targetVersion: SemverString,
  updateAvailable: z.boolean(),
  changeRequired: z.boolean(),
  installMethod: InstallMethodKindSchema,
  packageManager: PackageManagerSchema,
  binaryPath: z.string(),
  command: UpgradeCommandSchema.nullable(),
  canAutoInstall: z.boolean(),
});
export type UpgradeStatus = z.infer<typeof UpgradeStatus>;

const upgradeStatusView: ResourceView<UpgradeStatus> = {
  compactPick: UpgradeStatus,
  tableColumns: [
    { key: "currentVersion", label: "Current" },
    { key: "latestVersion", label: "Latest" },
    { key: "targetVersion", label: "Target" },
    { key: "updateAvailable", label: "Update available" },
    { key: "installMethod", label: "Install method" },
    { key: "command", label: "Upgrade command", format: formatCommandCell },
  ],
};

export default defineMetabaseCommand({
  meta: {
    name: "upgrade",
    description: "Upgrade the Metabase CLI itself to the latest published release",
  },
  args: {
    ...outputFlags,
    check: {
      type: "boolean",
      description: "Print update status without installing",
    },
    yes: {
      type: "boolean",
      description: "Skip the confirmation prompt",
      alias: "y",
    },
    to: {
      type: "string",
      description: "Target version (default: latest published)",
    },
    registry: {
      type: "string",
      description: "npm registry URL (default: https://registry.npmjs.org)",
    },
  },
  outputSchema: UpgradeStatus,
  examples: [
    "mb upgrade",
    "mb upgrade --check",
    "mb upgrade --check --json",
    "mb upgrade --yes",
    "mb upgrade --to 0.1.2",
  ],
  async run({ args, ctx }) {
    const currentVersion = SemverString.parse(packageJson.version);
    const install = detectInstallMethod(process.argv[1]);
    const distTags = await fetchNpmDistTags(packageJson.name, distTagsOptions(args.registry));
    const latestVersion = SemverString.parse(distTags.latest);
    const targetVersion = resolveTargetVersion(args.to, latestVersion);
    const updateAvailable = compareSemver(currentVersion, latestVersion) < 0;
    const changeRequired = compareSemver(currentVersion, targetVersion) !== 0;
    const command = buildInstallCommand(install, packageJson.name, targetVersion);
    const canAutoInstall = install.kind === "npm-global" && command !== null;
    const status: UpgradeStatus = {
      packageName: packageJson.name,
      currentVersion,
      latestVersion,
      targetVersion,
      updateAvailable,
      changeRequired,
      installMethod: install.kind,
      packageManager: install.packageManager,
      binaryPath: install.realPath,
      command: command === null ? null : { argv: [...command.argv], display: command.display },
      canAutoInstall,
    };
    emitStatus(status, install, command, ctx);
    if (args.check || !changeRequired || command === null || !canAutoInstall) {
      return;
    }
    const needsPrompt = !args.yes;
    if (needsPrompt && !process.stdin.isTTY) {
      return;
    }
    if (needsPrompt) {
      const confirmed = await promptConfirm({
        message: `Run "${command.display}" now?`,
        initialValue: true,
      });
      if (!confirmed) {
        throw new AbortError();
      }
    }
    const [bin, ...rest] = command.argv;
    const exitCode = await streamProcess(bin, rest, {
      shell: process.platform === "win32",
    });
    if (exitCode !== 0) {
      throw new UnknownError({
        originalMessage: `upgrade command exited with code ${exitCode ?? "unknown"}`,
        stack: null,
      });
    }
  },
});

function distTagsOptions(registryArg: string | undefined): FetchDistTagsOptions {
  const registry = registryArg?.trim();
  if (registry === undefined || registry === "") {
    return {};
  }
  return { registry };
}

function resolveTargetVersion(toArg: string | undefined, latestVersion: string): string {
  const trimmed = toArg?.trim();
  if (trimmed === undefined || trimmed === "") {
    return latestVersion;
  }
  return SemverString.parse(trimmed);
}

function emitStatus(
  status: UpgradeStatus,
  install: InstallMethod,
  command: InstallCommand | null,
  ctx: RenderOptions,
): void {
  if (ctx.format === "json" || ctx.fields !== undefined || ctx.full) {
    renderItem(status, upgradeStatusView, ctx);
    return;
  }
  writeText(buildHumanText(status, install, command));
}

function buildHumanText(
  status: UpgradeStatus,
  install: InstallMethod,
  command: InstallCommand | null,
): string {
  if (!status.changeRequired) {
    return `Up to date (${status.currentVersion}).`;
  }
  const header = [
    `Current version:  ${status.currentVersion}`,
    `Latest version:   ${status.latestVersion}`,
  ];
  if (status.targetVersion !== status.latestVersion) {
    header.push(`Target version:   ${status.targetVersion}`);
  }
  const tail = buildHumanTail(install, command);
  return [...header, "", ...tail].join("\n");
}

function buildHumanTail(install: InstallMethod, command: InstallCommand | null): string[] {
  switch (install.kind) {
    case "npm-global": {
      return [
        `Installed via:    ${install.packageManager} (global)`,
        `Binary path:      ${install.realPath}`,
        ...(command === null ? [] : [`Upgrade command: ${command.display}`]),
      ];
    }
    case "npm-local": {
      return [
        `Installed via:    ${install.packageManager} (local install)`,
        `Binary path:      ${install.realPath}`,
        ...(command === null ? [] : [`Run in that project: ${command.display}`]),
      ];
    }
    case "npx": {
      return [
        `Running via npx — no upgrade needed.`,
        `npx fetches the latest version on each invocation.`,
      ];
    }
    case "dev": {
      return [
        `Running from source at ${install.realPath}.`,
        `Pull the latest changes from git and rebuild to upgrade.`,
      ];
    }
    case "unknown": {
      return [
        `Could not detect how the CLI was installed${install.realPath === "" ? "" : ` (${install.realPath})`}.`,
        `Reinstall with your package manager — for example: npm install -g @metabase/cli@latest`,
      ];
    }
  }
}

function formatCommandCell(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "object" && "display" in value && typeof value.display === "string") {
    return value.display;
  }
  return "";
}
