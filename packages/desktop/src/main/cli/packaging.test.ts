import { readFile, readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { z } from "zod";

import { appIconPath, cliLocation } from "./paths";

const DESKTOP_ROOT = resolve(import.meta.dirname, "..", "..", "..");
const BUILDER_CONFIG = join(DESKTOP_ROOT, "electron-builder.yml");
const RESOURCES = "/resources";

const ExtraResource = z.object({ from: z.string(), to: z.string() }).strict();
const BuilderConfig = z.object({ extraResources: z.array(ExtraResource) }).loose();

type ExtraResource = z.infer<typeof ExtraResource>;

async function extraResources(): Promise<ExtraResource[]> {
  return BuilderConfig.parse(parse(await readFile(BUILDER_CONFIG, "utf8"))).extraResources;
}

function packagedRelative(path: string): string {
  return relative(RESOURCES, path);
}

describe("the packaged CLI layout", () => {
  const location = cliLocation({ kind: "packaged", resourcesPath: RESOURCES }, "/app");

  it("puts the CLI, its skills, the shims and the icon where the packaged app looks for them", async () => {
    const targets = (await extraResources()).map((resource) => resource.to);
    expect(targets.toSorted()).toEqual(
      [
        packagedRelative(join(location.entry, "..")),
        packagedRelative(location.skills),
        packagedRelative(location.bin),
        packagedRelative(appIconPath({ kind: "packaged", resourcesPath: RESOURCES })),
      ].toSorted(),
    );
  });

  // Git Bash, which Claude Code runs on Windows, finds `mb` and never `mb.cmd`; PowerShell and cmd
  // find `mb.cmd` alone.
  it("ships a shim for a POSIX shell and one for the Windows command processor", async () => {
    const bin = (await extraResources()).find(
      (resource) => resource.to === packagedRelative(location.bin),
    );
    if (bin === undefined) {
      throw new Error(`${BUILDER_CONFIG} copies nothing to ${location.bin}`);
    }
    const shims = await readdir(join(DESKTOP_ROOT, bin.from));
    expect(shims.toSorted()).toEqual(["mb", "mb.cmd"]);
  });
});
