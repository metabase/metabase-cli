import { promises as fs } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { z } from "zod";

import { ConfigError, isFileNotFoundError } from "@metabase/client/errors";

import { parseYamlResult } from "../../runtime/yaml";
import { lookupModel, validateEntity } from "./representation";
import { ValidationIssue } from "./validate";

// Metabase reads importable files from these directories only; a file elsewhere never applies.
export const IMPORT_ROOTS = ["collections", "databases", "transforms", "python_libraries"] as const;
const YAML_EXTENSION = ".yaml";

const FileValidationResult = z.object({
  file: z.string(),
  model: z.string().nullable(),
  ok: z.boolean(),
  errors: z.array(ValidationIssue),
});
type FileValidationResult = z.infer<typeof FileValidationResult>;

export const TreeValidationReport = z.object({
  ok: z.boolean(),
  checked: z.number().int(),
  passed: z.number().int(),
  failed: z.number().int(),
  results: z.array(FileValidationResult),
});
export type TreeValidationReport = z.infer<typeof TreeValidationReport>;

const ROOT_POINTER = "/";

type PathKind = "file" | "directory";

async function pathKind(path: string): Promise<PathKind> {
  let stat;
  try {
    stat = await fs.stat(path);
  } catch (error) {
    if (isFileNotFoundError(error)) {
      throw new ConfigError(`${path} does not exist`);
    }
    throw error;
  }
  if (stat.isFile()) {
    return "file";
  }
  if (stat.isDirectory()) {
    return "directory";
  }
  throw new ConfigError(`${path} is neither a file nor a directory`);
}

async function yamlFilesUnder(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(YAML_EXTENSION))
    .map((entry) => join(entry.parentPath, entry.name))
    .toSorted();
}

// With no path, the import roots that exist under `cwd`; a root that is absent is not an error,
// since a repository need not hold every entity kind.
async function defaultTargets(cwd: string): Promise<string[]> {
  const present: string[] = [];
  for (const root of IMPORT_ROOTS) {
    const dir = join(cwd, root);
    try {
      if ((await fs.stat(dir)).isDirectory()) {
        present.push(dir);
      }
    } catch (error) {
      if (!isFileNotFoundError(error)) {
        throw error;
      }
    }
  }
  return present;
}

async function collectYamlFiles(paths: readonly string[], cwd: string): Promise<string[]> {
  const targets =
    paths.length === 0 ? await defaultTargets(cwd) : paths.map((p) => resolve(cwd, p));
  const files: string[] = [];
  for (const target of targets) {
    if ((await pathKind(target)) === "file") {
      files.push(target);
    } else {
      files.push(...(await yamlFilesUnder(target)));
    }
  }
  return files;
}

function displayPath(file: string, cwd: string): string {
  const rel = relative(cwd, file);
  return rel.startsWith("..") ? file : rel.split(sep).join("/");
}

async function validateFile(file: string, cwd: string): Promise<FileValidationResult> {
  const shown = displayPath(file, cwd);
  const parsed = parseYamlResult(await fs.readFile(file, "utf8"), z.unknown(), { source: shown });
  if (!parsed.ok) {
    return {
      file: shown,
      model: null,
      ok: false,
      errors: [{ path: ROOT_POINTER, message: parsed.error.userMessage }],
    };
  }
  const lookup = lookupModel(parsed.value);
  if (lookup.kind === "missing-meta") {
    return {
      file: shown,
      model: null,
      ok: false,
      errors: [{ path: ROOT_POINTER, message: "missing serdes/meta, so no schema applies" }],
    };
  }
  if (lookup.kind === "unknown-model") {
    return {
      file: shown,
      model: lookup.model,
      ok: false,
      errors: [{ path: ROOT_POINTER, message: `unknown serdes/meta model "${lookup.model}"` }],
    };
  }
  const outcome = validateEntity(lookup.model, parsed.value);
  return { file: shown, model: lookup.model, ok: outcome.ok, errors: outcome.errors };
}

export async function validateTree(
  paths: readonly string[],
  cwd: string,
): Promise<TreeValidationReport> {
  const files = await collectYamlFiles(paths, cwd);
  const results: FileValidationResult[] = [];
  for (const file of files) {
    results.push(await validateFile(file, cwd));
  }
  const failed = results.filter((result) => !result.ok).length;
  return {
    ok: failed === 0,
    checked: results.length,
    passed: results.length - failed,
    failed,
    results,
  };
}
