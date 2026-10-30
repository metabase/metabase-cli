import { cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import type { Stats } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

import { z } from "zod";

import {
  DataAppActionDefinition,
  type DataAppGeneratedFile,
} from "@metabase/client/domain/data-app";
import { ConfigError, isFileNotFoundError } from "@metabase/client/errors";
import { parseJson } from "@metabase/client/json";

import { runProcess } from "./process";
import { parseYamlResult } from "./yaml";

const PackageManifest = z.object({}).loose();

// npm drops a `.gitignore` from a published package, so the template ships it under another name.
const SHIPPED_GITIGNORE = "gitignore";

// The dev preview reads its URL and API key from this file at the repository root.
const LOCAL_ENV_FILE = ".env.local";

export async function ignoreLocalEnv(gitignorePath: string): Promise<void> {
  const text = await readFile(gitignorePath, "utf8").catch((error: unknown) => {
    if (isFileNotFoundError(error)) {
      return "";
    }
    throw error;
  });
  if (text.split("\n").some((line) => line.trim() === LOCAL_ENV_FILE)) {
    return;
  }
  const separator = text === "" || text.endsWith("\n") ? "" : "\n";
  await writeFile(gitignorePath, `${text}${separator}${LOCAL_ENV_FILE}\n`, "utf8");
}

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

const DATA_APPS_DIR = "data_apps";
const DATA_APP_COLLECTIONS_DIR = "collections/data_apps";
const DATA_APP_CONTRACT_VERSION = 1;
const DATA_APP_BUNDLE_PATH = "dist/index.js";

// As Metabase slugs a collection's name for its stored slug and its serialized file name.
function slugifyName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9_]/g, "_");
}

function collectionName(slug: string): string {
  return `Data App: ${slug}`;
}

export function dataAppDir(slug: string): string {
  return join(DATA_APPS_DIR, slug);
}

export function dataAppCollectionDir(slug: string): string {
  return join(DATA_APP_COLLECTIONS_DIR, slugifyName(collectionName(slug)));
}

interface DataAppManifestInput {
  slug: string;
  entityId: string;
  collectionEntityId: string;
}

/** Writes the app's `data_app.yaml` and its collection's YAML file, as an export of the app writes them. */
export async function writeDataAppManifest({
  slug,
  entityId,
  collectionEntityId,
}: DataAppManifestInput): Promise<void> {
  const name = collectionName(slug);
  await writeProjectFile(
    join(dataAppDir(slug), "data_app.yaml"),
    [
      "allowed_hosts: []",
      `collection: ${collectionEntityId}`,
      "description: null",
      `entity_id: ${entityId}`,
      `name: ${slug}`,
      `path: ${DATA_APP_BUNDLE_PATH}`,
      `slug: ${slug}`,
      `version: ${DATA_APP_CONTRACT_VERSION}`,
      "serdes/meta:",
      "- model: DataApp",
      "",
    ].join("\n"),
  );
  await writeProjectFile(
    `${dataAppCollectionDir(slug)}.yaml`,
    [
      `name: '${name}'`,
      `entity_id: ${collectionEntityId}`,
      `slug: ${slugifyName(name)}`,
      "namespace: data-apps",
      "serdes/meta:",
      "- model: Collection",
      "",
    ].join("\n"),
  );
}

const NANO_ID_PATTERN = /^[A-Za-z0-9_-]{21}$/;

/** The entity ID of the collection the app's `data_app.yaml` names. */
export async function readDataAppCollectionEntityId(slug: string): Promise<string> {
  const path = join(dataAppDir(slug), "data_app.yaml");
  const collection = (await readFile(path, "utf8"))
    .split("\n")
    .find((line) => line.startsWith("collection:"))
    ?.slice("collection:".length)
    .trim();
  if (collection === undefined || !NANO_ID_PATTERN.test(collection)) {
    throw new ConfigError(`${path} names no collection by its entity ID`);
  }
  return collection;
}

/** The model of the content a generated collection file holds. */
export type DataAppContentModel = "Card" | "Action";

const SerdesFile = z
  .object({ "serdes/meta": z.array(z.object({ model: z.string() }).loose()) })
  .loose();

async function fileModel(path: string): Promise<string | null> {
  const parsed = parseYamlResult(await readFile(path, "utf8"), SerdesFile, { source: path });
  return parsed.ok ? (parsed.value["serdes/meta"].at(-1)?.model ?? null) : null;
}

/**
 * Replaces the files of the app's collection that hold `model` content with `files`, each at its path in the
 * collection's directory, leaving the files of other content as they are.
 */
export async function writeDataAppCollectionFiles(
  slug: string,
  model: DataAppContentModel,
  files: readonly DataAppGeneratedFile[],
): Promise<string> {
  const dir = dataAppCollectionDir(slug);
  const existing = await readdir(dir).catch((error: unknown) => {
    if (isFileNotFoundError(error)) {
      return [];
    }
    throw error;
  });
  for (const name of existing.filter((entry) => entry.endsWith(".yaml"))) {
    if ((await fileModel(join(dir, name))) === model) {
      await rm(join(dir, name));
    }
  }
  for (const file of files) {
    await writeProjectFile(join(dir, file.path), file.contents);
  }
  return dir;
}

const definitionsLoader = (path: string): string =>
  [
    'import { runnerImport } from "vite";',
    `const { module } = await runnerImport(${JSON.stringify(path)}, { configFile: false, logLevel: "silent" });`,
    "console.log(JSON.stringify({ ...module }));",
  ].join("\n");

const DataAppQueryDefinitions = z.record(z.string(), z.object({ entityId: z.string() }).loose());
const DataAppActionDefinitions = z.record(z.string(), DataAppActionDefinition);

async function loadDefinitions<T>(slug: string, file: string, schema: z.ZodType<T>): Promise<T> {
  const dir = dataAppDir(slug);
  const result = await runProcess("node", ["--input-type=module", "-e", definitionsLoader(file)], {
    cwd: dir,
  });
  if (result.exitCode !== 0) {
    throw new ConfigError(
      `could not load ${join(dir, file)} (run \`npm install\` there first): ${result.stderr.trim()}`,
    );
  }
  return parseJson(result.stdout, schema, { source: join(dir, file) });
}

/** The `defineQuery` exports of the app's `src/metabase.queries.ts`, loaded with the app's own Vite. */
export function loadDataAppQueries(slug: string): Promise<z.infer<typeof DataAppQueryDefinitions>> {
  return loadDefinitions(slug, "./src/metabase.queries.ts", DataAppQueryDefinitions);
}

/** The `defineAction` exports of the app's `src/metabase.actions.ts`, loaded with the app's own Vite. */
export function loadDataAppActions(
  slug: string,
): Promise<z.infer<typeof DataAppActionDefinitions>> {
  return loadDefinitions(slug, "./src/metabase.actions.ts", DataAppActionDefinitions);
}
