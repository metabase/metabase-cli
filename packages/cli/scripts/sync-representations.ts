// Idempotent — CI runs this and asserts no diff. Requires `npm` and `tar` on PATH.
import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import yaml from "js-yaml";
import { z } from "zod";

import { isNotFoundError } from "../src/core/errors";

const YamlObject = z.record(z.string(), z.unknown());

const REPRESENTATIONS_VERSION = "1.1.7";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(SCRIPT_DIR, "..");
const DATA_DIR = resolve(PACKAGE_ROOT, "src/core/schema/data");
const COMMON_DIR = resolve(DATA_DIR, "schemas/common");

async function main(): Promise<void> {
  const tarball = await npmPack(REPRESENTATIONS_VERSION);
  const extracted = await extractTarball(tarball);
  try {
    await syncCommonSchemas(extracted);
    await copyLicense(extracted);
  } finally {
    await cleanupDir(extracted);
  }
  // eslint-disable-next-line no-console -- script
  console.log(`Synced @metabase/representations@${REPRESENTATIONS_VERSION}`);
}

async function syncCommonSchemas(packageRoot: string): Promise<void> {
  const sourceDir = resolve(packageRoot, "core-spec/v1/schemas/common");
  await fs.rm(resolve(DATA_DIR, "schemas"), { recursive: true, force: true });
  await fs.mkdir(COMMON_DIR, { recursive: true });

  const files = await fs.readdir(sourceDir);
  await Promise.all(files.filter((f) => f.endsWith(".yaml")).map((f) => convertOne(sourceDir, f)));
}

async function convertOne(sourceDir: string, filename: string): Promise<void> {
  const text = await fs.readFile(join(sourceDir, filename), "utf8");
  const parsed = YamlObject.parse(yaml.load(text));
  const { $schema: _ignored, ...body } = parsed;
  const targetName = filename.replace(/\.yaml$/u, ".json");
  await fs.writeFile(join(COMMON_DIR, targetName), JSON.stringify(body, null, 2) + "\n", "utf8");
}

async function copyLicense(packageRoot: string): Promise<void> {
  const sourceLicense = join(packageRoot, "LICENSE.txt");
  let text: string;
  try {
    text = await fs.readFile(sourceLicense, "utf8");
  } catch (error) {
    if (isNotFoundError(error)) {
      return;
    }
    throw error;
  }
  await fs.writeFile(join(DATA_DIR, "LICENSE.txt"), text, "utf8");
}

async function cleanupDir(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch (error) {
    // eslint-disable-next-line no-console -- script
    console.warn(`failed to clean up ${dir}: ${error instanceof Error ? error.message : error}`);
  }
}

async function npmPack(version: string): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "representations-pack-"));
  const stdout = execFileSync("npm", ["pack", `@metabase/representations@${version}`, "--silent"], {
    cwd: dir,
    encoding: "utf8",
  });
  const filename = stdout.trim().split("\n").pop();
  if (filename === undefined || filename === "") {
    throw new Error(`npm pack produced no output for @metabase/representations@${version}`);
  }
  return join(dir, filename);
}

async function extractTarball(tarballPath: string): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "representations-extract-"));
  execFileSync("tar", ["-xzf", tarballPath, "-C", dir]);
  return join(dir, "package");
}

await main();
