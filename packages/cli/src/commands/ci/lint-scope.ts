import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { ValidationError } from "@metabase/client/errors";

import { classifyContentFile } from "../../core/ci-affected";
import type { CheckedTransform } from "../../core/ci-events";
import { filesMatching, readFilesAt, repositoryRoot } from "../../runtime/git";
import { parseMetabaseYaml } from "../../runtime/yaml";
import { CONTENT_PATHSPECS } from "./job-plan";

const SETTINGS_FILE = ".metabase-lint.json";
const ENTITY_ID = /^[\w-]+$/;
const DATABASE_FILE = /^databases\/([^/]+)\/\1\.yaml$/;
const DATABASE_MODEL_PATTERN = "^- model: Database$";
const SHARED_MODELS_PATTERN = "^- model: (NativeQuerySnippet|TransformTag)$";

export interface LintScopeParams {
  repo: string;
  head: string;
  checked: readonly CheckedTransform[];
  signal: AbortSignal;
}

function stringField(text: string, source: string, field: string): string | null {
  const document = parseMetabaseYaml(text, source).yaml12;
  if (typeof document !== "object" || document === null) {
    return null;
  }
  const value = Object.entries(document).find(([key]) => key === field)?.[1];
  return typeof value === "string" ? value : null;
}

interface TransformFiles {
  paths: string[];
  collections: string[];
}

async function transformFiles(
  { head, checked, signal }: LintScopeParams,
  root: string,
): Promise<TransformFiles> {
  const wanted = new Set(checked.map((transform) => transform.entity_id));
  const ids = [...wanted].filter((id) => ENTITY_ID.test(id)).join("|");
  const candidates = await filesMatching(
    root,
    head,
    `^(entity_id|transform_id): ['"]?(${ids})['"]?$`,
    CONTENT_PATHSPECS,
    signal,
  );
  const paths: string[] = [];
  const collections: string[] = [];
  for (const [path, text] of await readFilesAt(root, head, candidates, signal)) {
    try {
      const file = classifyContentFile(path, parseMetabaseYaml(text, `${head}:${path}`));
      if (file.kind === "transform" && wanted.has(file.entityId)) {
        paths.push(path);
        const collection = stringField(text, path, "collection_id");
        if (collection !== null) {
          collections.push(collection);
        }
      } else if (file.kind === "transform-test" && wanted.has(file.transformId)) {
        paths.push(path);
      }
    } catch (error) {
      if (!(error instanceof ValidationError)) {
        throw error;
      }
    }
  }
  return { paths, collections };
}

async function collectionChainFiles(
  root: string,
  head: string,
  collections: readonly string[],
  signal: AbortSignal,
): Promise<string[]> {
  const seen = new Set<string>();
  const paths: string[] = [];
  const pending = [...collections];
  while (pending.length > 0) {
    const id = pending.pop();
    if (id === undefined || seen.has(id) || !ENTITY_ID.test(id)) {
      continue;
    }
    seen.add(id);
    const [path] = await filesMatching(
      root,
      head,
      `^entity_id: ['"]?${id}['"]?$`,
      CONTENT_PATHSPECS,
      signal,
    );
    if (path === undefined) {
      continue;
    }
    paths.push(path);
    const text = (await readFilesAt(root, head, [path], signal)).get(path);
    const parent = text === undefined ? null : stringField(text, path, "parent_id");
    if (parent !== null) {
      pending.push(parent);
    }
  }
  return paths;
}

async function scopedPaths(params: LintScopeParams, root: string): Promise<string[]> {
  const { head, signal } = params;
  const { paths, collections } = await transformFiles(params, root);
  const [chain, databases, shared, settings] = await Promise.all([
    collectionChainFiles(root, head, collections, signal),
    filesMatching(root, head, DATABASE_MODEL_PATTERN, ["databases/*.yaml"], signal),
    filesMatching(root, head, SHARED_MODELS_PATTERN, CONTENT_PATHSPECS, signal),
    filesMatching(root, head, ".", [SETTINGS_FILE], signal),
  ]);
  return [
    ...new Set([
      ...paths,
      ...chain,
      ...databases.filter((path) => DATABASE_FILE.test(path)),
      ...shared,
      ...settings,
    ]),
  ];
}

export async function withLintScope<T>(
  params: LintScopeParams,
  use: (folder: string) => Promise<T>,
): Promise<T> {
  const root = await repositoryRoot(params.repo, params.signal);
  const paths = await scopedPaths(params, root);
  const files = await readFilesAt(root, params.head, paths, params.signal);
  const folder = await mkdtemp(join(tmpdir(), "mb-ci-lint-"));
  try {
    for (const [path, text] of files) {
      const destination = join(folder, path);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, text, "utf8");
    }
    return await use(folder);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}
