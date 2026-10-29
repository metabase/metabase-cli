import { cp, mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import type { Stats } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

import { z } from "zod";

import { ConfigError, isFileNotFoundError } from "@metabase/client/errors";
import { parseJson } from "@metabase/client/json";

const PackageManifest = z.object({}).loose();

// npm drops a `.gitignore` from a published package, so the template ships it under another name.
const SHIPPED_GITIGNORE = "gitignore";

export async function writeProjectFile(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text, "utf8");
}

async function statOrNull(path: string): Promise<Stats | null> {
  try {
    return await stat(path);
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return null;
    }
    throw error;
  }
}

async function isMissingOrEmpty(dir: string): Promise<boolean> {
  const entry = await statOrNull(dir);
  if (entry === null) {
    return true;
  }
  if (!entry.isDirectory()) {
    throw new ConfigError(`${dir} is not a directory — scaffold into a new or empty directory`);
  }
  return (await readdir(dir)).length === 0;
}

// npm package names are lowercase and URL-safe, and start with neither a dot nor an underscore.
function packageNameFor(dir: string): string {
  const dashed = basename(resolve(dir))
    .toLowerCase()
    .replace(/[^a-z0-9._~-]+/g, "-");
  const name = dashed.replace(/^[-._]+/, "").replace(/-+$/, "");
  if (name === "") {
    throw new ConfigError(
      `cannot name the package after ${dir} — scaffold into a directory whose name has a letter or a digit`,
    );
  }
  return name;
}

async function renamePackage(dir: string, name: string): Promise<void> {
  const path = join(dir, "package.json");
  const manifest = parseJson(await readFile(path, "utf8"), PackageManifest);
  await writeFile(path, `${JSON.stringify({ ...manifest, name }, null, 2)}\n`, "utf8");
}

interface ScaffoldInput {
  dir: string;
  templateDir: string;
}

/** Copies the app template into `dir`, which must be missing or empty, and names its package after `dir`. */
export async function scaffoldDataAppProject({ dir, templateDir }: ScaffoldInput): Promise<void> {
  const packageName = packageNameFor(dir);
  if (!(await isMissingOrEmpty(dir))) {
    throw new ConfigError(`${dir} is not empty — scaffold into a new or empty directory`);
  }
  await cp(templateDir, dir, { recursive: true });
  await rename(join(dir, SHIPPED_GITIGNORE), join(dir, ".gitignore"));
  await renamePackage(dir, packageName);
}
