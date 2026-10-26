import { z } from "zod";

import { InternalError, ValidationError } from "@metabase/client/errors";
import { isPlainObject } from "@metabase/client/predicates";

import type { CiWarning } from "./ci-events";

interface PathEntry {
  status: "added" | "modified" | "deleted";
  path: string;
}

interface RenamedEntry {
  status: "renamed";
  path: string;
  oldPath: string;
}

export type DiffEntry = PathEntry | RenamedEntry;

interface TransformFile {
  kind: "transform";
  entityId: string;
  name: string;
}

interface TransformTestFile {
  kind: "transform-test";
  transformId: string;
}

interface OtherFile {
  kind: "other";
}

export type ContentFile = TransformFile | TransformTestFile | OtherFile;

export interface ClassifiedChange {
  base: ContentFile | null;
  head: ContentFile | null;
}

const SINGLE_PATH_STATUSES = new Map<string, PathEntry["status"]>([
  ["A", "added"],
  ["M", "modified"],
  ["D", "deleted"],
  ["T", "modified"],
]);

const RENAME_STATUS = "R";
// A copy leaves its source untouched, so only the new path is a change.
const COPY_STATUS = "C";

function nameStatusError(message: string): InternalError {
  return new InternalError(`git diff --name-status -z: ${message}`);
}

function requireToken(token: string | undefined, what: string): string {
  if (token === undefined || token === "") {
    throw nameStatusError(`missing ${what}`);
  }
  return token;
}

export function parseNameStatus(output: string): DiffEntry[] {
  if (output === "") {
    return [];
  }
  if (!output.endsWith("\0")) {
    throw nameStatusError("truncated: the output does not end in a NUL");
  }
  const tokens = output.slice(0, -1).split("\0");
  const entries: DiffEntry[] = [];
  let index = 0;
  while (index < tokens.length) {
    const code = requireToken(tokens[index], "a status");
    const missingPath = `a path for status "${code}"`;
    const first = tokens[index + 1];
    const second = tokens[index + 2];
    const letter = code.charAt(0);
    const single = SINGLE_PATH_STATUSES.get(letter);
    if (single !== undefined) {
      entries.push({ status: single, path: requireToken(first, missingPath) });
      index += 2;
      continue;
    }
    if (letter === RENAME_STATUS) {
      entries.push({
        status: "renamed",
        path: requireToken(second, missingPath),
        oldPath: requireToken(first, missingPath),
      });
      index += 3;
      continue;
    }
    if (letter === COPY_STATUS) {
      entries.push({ status: "added", path: requireToken(second, missingPath) });
      index += 3;
      continue;
    }
    throw nameStatusError(`unexpected status "${code}"`);
  }
  return entries;
}

const PORCELAIN_STATUS_WIDTH = 2;
const PORCELAIN_SOURCE_STATUSES = new Set(["R", "C"]);

// `git status --porcelain -z` writes `XY path` per entry; a rename or copy is followed by its
// source path as a separate token, which is not itself a change.
export function parseStatusPorcelain(output: string): string[] {
  if (output === "") {
    return [];
  }
  if (!output.endsWith("\0")) {
    throw new InternalError(
      "git status --porcelain -z: truncated: the output does not end in a NUL",
    );
  }
  const paths: string[] = [];
  let sourceFollows = false;
  for (const record of output.slice(0, -1).split("\0")) {
    if (sourceFollows) {
      sourceFollows = false;
      continue;
    }
    const status = record.slice(0, PORCELAIN_STATUS_WIDTH);
    const path = record.slice(PORCELAIN_STATUS_WIDTH + 1);
    if (
      status.length !== PORCELAIN_STATUS_WIDTH ||
      record.charAt(PORCELAIN_STATUS_WIDTH) !== " " ||
      path === ""
    ) {
      throw new InternalError(`git status --porcelain -z: malformed entry "${record}"`);
    }
    paths.push(path);
    sourceFollows = [...status].some((letter) => PORCELAIN_SOURCE_STATUSES.has(letter));
  }
  return paths;
}

const SERDES_META_KEY = "serdes/meta";

const TransformDocument = z
  .object({ entity_id: z.string().min(1), name: z.string().min(1) })
  .loose();
const TransformTestDocument = z.object({ transform_id: z.string().min(1) }).loose();

const SerdesMeta = z.array(z.object({ model: z.string() }).loose()).min(1);

function serdesModel(path: string, document: unknown): string | null {
  if (!isPlainObject(document) || !(SERDES_META_KEY in document)) {
    return null;
  }
  const meta = SerdesMeta.safeParse(document[SERDES_META_KEY]);
  if (!meta.success) {
    throw new ValidationError(
      `${path}: ${SERDES_META_KEY} must be a non-empty list of entries with a model`,
      { source: path, zodIssues: meta.error.issues },
    );
  }
  const last = meta.data.at(-1);
  if (last === undefined) {
    throw new InternalError(
      `${path}: ${SERDES_META_KEY} passed a non-empty check but has no entries`,
    );
  }
  return last.model;
}

export function classifyContentFile(path: string, document: unknown): ContentFile {
  const model = serdesModel(path, document);
  if (model === "Transform") {
    const transform = TransformDocument.safeParse(document);
    if (!transform.success) {
      throw new ValidationError(`${path}: a Transform must have an entity_id and a name`, {
        source: path,
        zodIssues: transform.error.issues,
      });
    }
    return { kind: "transform", entityId: transform.data.entity_id, name: transform.data.name };
  }
  if (model === "TransformTest") {
    const test = TransformTestDocument.safeParse(document);
    if (!test.success) {
      throw new ValidationError(`${path}: a TransformTest must name its transform_id`, {
        source: path,
        zodIssues: test.error.issues,
      });
    }
    return { kind: "transform-test", transformId: test.data.transform_id };
  }
  return { kind: "other" };
}

function transformEntityId(file: ContentFile | null): string | null {
  return file?.kind === "transform" ? file.entityId : null;
}

export function affectedTransforms(changes: readonly ClassifiedChange[]): string[] {
  const touched = new Set<string>();
  const atHead = new Set<string>();
  const atBase = new Set<string>();

  for (const { base, head } of changes) {
    const headId = transformEntityId(head);
    const baseId = transformEntityId(base);
    if (headId !== null) {
      touched.add(headId);
      atHead.add(headId);
    }
    if (baseId !== null) {
      atBase.add(baseId);
    }
    for (const side of [base, head]) {
      if (side?.kind === "transform-test") {
        touched.add(side.transformId);
      }
    }
  }

  return [...touched].filter((entityId) => atHead.has(entityId) || !atBase.has(entityId));
}

export const CONTENT_FILE_EXTENSIONS = [".yaml", ".yml"] as const;

export function isContentPath(path: string): boolean {
  return CONTENT_FILE_EXTENSIONS.some((extension) => path.endsWith(extension));
}

export function uncommittedContentWarning(paths: readonly string[]): CiWarning | null {
  const content = paths.filter(isContentPath);
  if (content.length === 0) {
    return null;
  }
  const summary =
    content.length === 1 ? "1 content file is" : `${content.length} content files are`;
  return {
    code: "uncommitted-content",
    message: `${summary} not committed, so CI did not check: ${content.join(", ")}`,
  };
}
