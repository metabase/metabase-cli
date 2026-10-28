import { z } from "zod";

import { InternalError, ValidationError } from "@metabase/client/errors";
import { isPlainObject } from "@metabase/client/predicates";

import type { MetabaseYaml } from "../runtime/yaml";
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
  logic: TransformLogic;
  // Metabase tests only a query transform, and refuses a test of any other, such as a Python one.
  testable: boolean;
}

interface TransformTestFile {
  kind: "transform-test";
  transformId: string;
  // A test with no expectations checks nothing, so it does not count as testing its transform.
  hasExpectations: boolean;
}

interface OtherFile {
  kind: "other";
}

export type ContentFile = TransformFile | TransformTestFile | OtherFile;

export interface ClassifiedChange {
  path: string;
  base: ContentFile | null;
  head: ContentFile | null;
}

const SINGLE_PATH_STATUSES = new Map<string, PathEntry["status"]>([
  ["A", "added"],
  ["M", "modified"],
  ["D", "deleted"],
  ["T", "modified"],
]);

// A score follows R and C always, and M only under -B.
const STATUS_CODE = /^(?:[AMDT](?:\d{3})?|[RC]\d{3})$/;
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
    if (!STATUS_CODE.test(code)) {
      throw nameStatusError(`unexpected status "${code}"`);
    }
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
      requireToken(first, missingPath);
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
  .object({
    entity_id: z.string().min(1),
    name: z.string().min(1),
    source: z.unknown(),
    target: z.unknown(),
  })
  .loose();
const TransformLogicDocument = TransformDocument.pick({ source: true, target: true });

type LogicReading = z.infer<typeof TransformLogicDocument>;

// What a transform computes. An edit to anything else (name, description, collection, tags) leaves
// its logic unchanged. Metabase reads YAML 1.1, where an unquoted `on` is true and `017` is 15, and
// this check reads YAML 1.2, so the logic holds both readings: an edit either parser sees changes it.
export interface TransformLogic {
  yaml12: LogicReading;
  yaml11: LogicReading;
}

const QUERY_SOURCE_TYPE = "query";

// A source that names no type is held to the query rule, so a malformed transform still needs a test.
function isTestableSource(source: unknown): boolean {
  if (!isPlainObject(source)) {
    return true;
  }
  const type = source["type"];
  return typeof type !== "string" || type === QUERY_SOURCE_TYPE;
}

const TRANSFORM_RULE = "a Transform must have an entity_id, a name, a source and a target";
const TRANSFORM_TEST_RULE =
  "a TransformTest must name its transform_id, and its expectations must be a list";
const TransformTestDocument = z
  .object({ transform_id: z.string().min(1), expectations: z.array(z.unknown()).nullish() })
  .loose();

const SerdesMeta = z.array(z.object({ model: z.string() }).loose()).min(1);

function parseOrRefuse<T>(path: string, schema: z.ZodType<T>, value: unknown, rule: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError(`${path}: ${rule}`, { source: path, zodIssues: parsed.error.issues });
  }
  return parsed.data;
}

export function classifyContentFile(path: string, yaml: MetabaseYaml): ContentFile {
  const document = yaml.yaml12;
  if (!isPlainObject(document) || !(SERDES_META_KEY in document)) {
    return { kind: "other" };
  }
  const meta = parseOrRefuse(
    path,
    SerdesMeta,
    document[SERDES_META_KEY],
    `${SERDES_META_KEY} must be a non-empty list of entries with a model`,
  );
  // serdes/meta is the path from the root entity down to this file's own entity, which comes last.
  const last = meta.at(-1);
  if (last === undefined) {
    throw new InternalError(
      `${path}: ${SERDES_META_KEY} passed a non-empty check but has no entries`,
    );
  }
  if (last.model === "Transform") {
    const transform = parseOrRefuse(path, TransformDocument, document, TRANSFORM_RULE);
    const asYaml11 = parseOrRefuse(path, TransformLogicDocument, yaml.yaml11, TRANSFORM_RULE);
    return {
      kind: "transform",
      entityId: transform.entity_id,
      name: transform.name,
      logic: {
        yaml12: { source: transform.source, target: transform.target },
        yaml11: { source: asYaml11.source, target: asYaml11.target },
      },
      testable: isTestableSource(transform.source),
    };
  }
  if (last.model === "TransformTest") {
    const test = parseOrRefuse(path, TransformTestDocument, document, TRANSFORM_TEST_RULE);
    const expectations = test.expectations;
    const hasExpectations =
      expectations !== undefined && expectations !== null && expectations.length > 0;
    return { kind: "transform-test", transformId: test.transform_id, hasExpectations };
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

  for (const { path, base, head } of changes) {
    // A parser that reads the file differently from Metabase (a YAML merge key, a symlink blob)
    // would otherwise turn an edited transform into a deleted one.
    if (base !== null && base.kind !== "other" && head?.kind === "other") {
      throw new ValidationError(
        `${path}: a Transform or TransformTest at base no longer reads as one at head`,
        { source: path, zodIssues: [] },
      );
    }
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

  // A test-only change names a transform the diff does not show; keep it unless the diff removed it.
  return [...touched].filter((entityId) => atHead.has(entityId) || !atBase.has(entityId));
}

// Every Transform and TransformTest file names its model in `serdes/meta`, however the YAML spells
// the entry (quoted, tagged, folded, on the next line), so the word alone finds them; only a model
// written with an escape (`\x54ransform`), which no export writes, is missed. Every match is read, so
// the scan also reads the other content files that mention the word. A POSIX extended pattern, for
// `git grep -E`.
export const TRANSFORM_MODEL_PATTERN = "Transform";

export interface HeadTransforms {
  names: Map<string, string>;
  tested: Set<string>;
  testedWithoutExpectations: Set<string>;
  untestable: Set<string>;
}

// The transforms among files at head, each by name, the transforms a test with expectations at head
// covers, those only tests without expectations name, and the transforms Metabase cannot test.
export function headTransforms(files: readonly (ContentFile | null)[]): HeadTransforms {
  const atHead: HeadTransforms = {
    names: new Map(),
    tested: new Set(),
    testedWithoutExpectations: new Set(),
    untestable: new Set(),
  };
  for (const file of files) {
    if (file?.kind === "transform") {
      atHead.names.set(file.entityId, file.name);
      if (!file.testable) {
        atHead.untestable.add(file.entityId);
      }
    } else if (file?.kind === "transform-test") {
      const covered = file.hasExpectations ? atHead.tested : atHead.testedWithoutExpectations;
      covered.add(file.transformId);
    }
  }
  for (const entityId of atHead.tested) {
    atHead.testedWithoutExpectations.delete(entityId);
  }
  return atHead;
}

// Mirrors Metabase's `legal-top-level-paths` and `shared-top-level-paths`
// (serialization/v2/ingest.clj): the top-level folders an import reads entity files from.
export const CONTENT_TOP_LEVEL_FOLDERS = [
  "actions",
  "channels",
  "collections",
  "custom_viz_plugins",
  "data_apps",
  "databases",
  "embedding_themes",
  "glossary",
  "metabots",
  "python_libraries",
  "python-libraries",
  "osi_ai_context",
  "snippets",
  "transforms",
] as const;

const SHARED_TOP_LEVEL_FILE_NAMES = new Map<string, string>([["data_apps", "data_app.yaml"]]);

const CONTENT_FOLDERS = new Set<string>(CONTENT_TOP_LEVEL_FOLDERS);

// Mirrors Metabase's `entity-file-path?`: a `.yaml` file that is not a dotfile, under a legal
// top-level folder, named its folder's entity file when that folder is shared.
export function isContentPath(path: string): boolean {
  const slash = path.indexOf("/");
  if (slash === -1) {
    return false;
  }
  const top = path.slice(0, slash);
  const fileName = path.slice(path.lastIndexOf("/") + 1);
  if (!fileName.endsWith(".yaml") || fileName.startsWith(".") || !CONTENT_FOLDERS.has(top)) {
    return false;
  }
  const entityFileName = SHARED_TOP_LEVEL_FILE_NAMES.get(top);
  return entityFileName === undefined || entityFileName === fileName;
}

// Without it, a diff with no content file passes with an empty `checked`, as if CI had verified it.
export function noContentChangesWarning(entries: readonly DiffEntry[]): CiWarning | null {
  const touchesContent = entries.some(
    (entry) =>
      isContentPath(entry.path) || (entry.status === "renamed" && isContentPath(entry.oldPath)),
  );
  if (touchesContent) {
    return null;
  }
  return {
    code: "no-content-changes",
    message: "the change touches no Metabase content files, so no transform test ran",
  };
}

export function uncommittedContentWarning(paths: readonly string[]): CiWarning | null {
  const content = paths.filter(isContentPath);
  if (content.length === 0) {
    return null;
  }
  const summary =
    content.length === 1
      ? "1 content file has uncommitted changes"
      : `${content.length} content files have uncommitted changes`;
  return {
    code: "uncommitted-content",
    message: `${summary}, which CI does not see; it checks the committed version: ${content.join(", ")}`,
  };
}

// A file at head that the change did not touch cannot be the change's fault, so it does not stop the
// job; Metabase may still read it, and a transform or test in it goes uncounted.
export function unreadContentWarning(reasons: readonly string[]): CiWarning | null {
  if (reasons.length === 0) {
    return null;
  }
  const summary =
    reasons.length === 1
      ? "1 content file this change did not touch could not be read, so the coverage check skipped it"
      : `${reasons.length} content files this change did not touch could not be read, so the coverage check skipped them`;
  return { code: "unread-content", message: `${summary}: ${reasons.join("; ")}` };
}
