// Requires `npm` and `tar` on PATH; run by hand, no workflow invokes it. Idempotent, and the sole
// owner of the formatting of what it writes — `.oxfmtrc.json` ignores
// `packages/cli/src/core/schema/data/**`, so oxfmt never reformats a vendored payload.
import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import yaml from "js-yaml";
import { z } from "zod";

import { isFileNotFoundError } from "@metabase/client/errors";

const YamlObject = z.record(z.string(), z.unknown());

const REPRESENTATIONS_VERSION = "1.2.0";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const DATA_DIR = resolve(REPO_ROOT, "packages/cli/src/core/schema/data");
const SCHEMAS_DIR = resolve(DATA_DIR, "schemas");
const COMMON_DIR = resolve(SCHEMAS_DIR, "common");

async function main(): Promise<void> {
  const tarball = await npmPack(REPRESENTATIONS_VERSION);
  const extracted = await extractTarball(tarball);
  try {
    await syncSchemas(extracted);
    await copyLicense(extracted);
  } finally {
    await cleanupDir(extracted);
  }
  // eslint-disable-next-line no-console -- script
  console.log(`Synced @metabase/representations@${REPRESENTATIONS_VERSION}`);
}

// The entity schemas land beside `common/`, each as JSON under the name its `$ref`s use.
async function syncSchemas(packageRoot: string): Promise<void> {
  const sourceDir = resolve(packageRoot, "core-spec/v1/schemas");
  await fs.rm(SCHEMAS_DIR, { recursive: true, force: true });
  await fs.mkdir(COMMON_DIR, { recursive: true });
  await convertDir(resolve(sourceDir, "common"), COMMON_DIR);
  await convertDir(sourceDir, SCHEMAS_DIR);
}

async function convertDir(sourceDir: string, targetDir: string): Promise<void> {
  const files = await fs.readdir(sourceDir);
  await Promise.all(
    files.filter((f) => f.endsWith(".yaml")).map((f) => convertOne(sourceDir, targetDir, f)),
  );
}

async function convertOne(sourceDir: string, targetDir: string, filename: string): Promise<void> {
  const text = await fs.readFile(join(sourceDir, filename), "utf8");
  const parsed = YamlObject.parse(yaml.load(text));
  const { $schema: _ignored, ...body } = parsed;
  const targetName = filename.replace(/\.yaml$/u, ".json");
  await fs.writeFile(join(targetDir, targetName), JSON.stringify(body, null, 2) + "\n", "utf8");
}

async function copyLicense(packageRoot: string): Promise<void> {
  const sourceLicense = join(packageRoot, "LICENSE.txt");
  let text: string;
  try {
    text = await fs.readFile(sourceLicense, "utf8");
  } catch (error) {
    if (isFileNotFoundError(error)) {
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
