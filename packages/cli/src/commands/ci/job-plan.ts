import { InternalError, ValidationError } from "@metabase/client/errors";

import {
  type ClassifiedChange,
  type ContentFile,
  type DiffEntry,
  CONTENT_TOP_LEVEL_FOLDERS,
  affectedTransforms,
  classifyContentFile,
  isContentPath,
  parseNameStatus,
  parseStatusPorcelain,
  uncommittedContentWarning,
} from "../../core/ci-affected";
import { type CoverageAssessment, assessCoverage } from "../../core/ci-coverage";
import type { CheckedTransform, CiWarning, Snapshot } from "../../core/ci-events";
import {
  checkedOutCommit,
  diffNameStatus,
  fileModesAt,
  filesMatching,
  mergeBase,
  readFilesAt,
  repositoryRoot,
  resolveCommit,
  statusPorcelain,
} from "../../runtime/git";
import { parseMetabaseYaml } from "../../runtime/yaml";

// A pathspec `*` also matches `/`, so each covers every depth; isContentPath narrows the hits.
const CONTENT_PATHSPECS = CONTENT_TOP_LEVEL_FOLDERS.map((folder) => `${folder}/*.yaml`);

export interface JobPlan {
  snapshot: Snapshot;
  checked: CheckedTransform[];
  warnings: CiWarning[];
  coverage: CoverageAssessment;
}

// A regular or executable file. Metabase's import follows a symlink and reads a submodule's
// checkout, neither of which this check can see, so those are refused rather than dropped.
const FILE_MODES = new Set(["100644", "100755"]);

// Reads and classifies the content files among `paths` at one commit, in one batch.
async function classifyAt(
  repo: string,
  commit: string,
  paths: readonly string[],
): Promise<Map<string, ContentFile>> {
  const content = paths.filter(isContentPath);
  if (content.length === 0) {
    return new Map();
  }
  const modes = await fileModesAt(repo, commit);
  for (const path of content) {
    const mode = modes.get(path);
    if (mode === undefined) {
      throw new InternalError(`git listed ${path} at ${commit}, but its tree does not hold it`);
    }
    if (!FILE_MODES.has(mode)) {
      throw new ValidationError(
        `${commit}:${path} is not a regular file (git mode ${mode}): Metabase would import what it points to, which this check cannot read; commit the file itself`,
        { source: `${commit}:${path}`, zodIssues: [] },
      );
    }
  }
  const classified = new Map<string, ContentFile>();
  for (const [path, text] of await readFilesAt(repo, commit, content)) {
    classified.set(path, classifyContentFile(path, parseMetabaseYaml(text, `${commit}:${path}`)));
  }
  return classified;
}

function basePath(entry: DiffEntry): string | null {
  if (entry.status === "added") {
    return null;
  }
  return entry.status === "renamed" ? entry.oldPath : entry.path;
}

function headPath(entry: DiffEntry): string | null {
  return entry.status === "deleted" ? null : entry.path;
}

function present(paths: readonly (string | null)[]): string[] {
  return paths.filter((path) => path !== null);
}

function sideOf(files: ReadonlyMap<string, ContentFile>, path: string | null): ContentFile | null {
  if (path === null || !isContentPath(path)) {
    return null;
  }
  const file = files.get(path);
  if (file === undefined) {
    throw new InternalError(`${path} was not read, though the diff names it`);
  }
  return file;
}

async function classifyChanges(
  repo: string,
  forkPoint: string,
  head: string,
  entries: readonly DiffEntry[],
): Promise<ClassifiedChange[]> {
  const [baseFiles, headFiles] = await Promise.all([
    classifyAt(repo, forkPoint, present(entries.map(basePath))),
    classifyAt(repo, head, present(entries.map(headPath))),
  ]);
  return entries.map((entry) => ({
    path: entry.path,
    base: sideOf(baseFiles, basePath(entry)),
    head: sideOf(headFiles, headPath(entry)),
  }));
}

// Every Transform and TransformTest file names its model in `serdes/meta`, as `model: Transform…`,
// with the key or value possibly quoted and spaced; matching more only costs a read the classifier
// discards.
const TRANSFORM_MODEL_PATTERN = `model["']?:[[:space:]]*["']?Transform`;

interface HeadTransforms {
  names: Map<string, string>;
  tested: Set<string>;
}

function record(atHead: HeadTransforms, file: ContentFile | null): void {
  if (file?.kind === "transform") {
    atHead.names.set(file.entityId, file.name);
  } else if (file?.kind === "transform-test") {
    atHead.tested.add(file.transformId);
  }
}

// The changed files are already classified exactly; the scan adds every other file at head whose
// text names a Transform model.
async function scanHead(
  repo: string,
  head: string,
  changes: readonly ClassifiedChange[],
  changedPaths: ReadonlySet<string>,
): Promise<HeadTransforms> {
  const atHead: HeadTransforms = { names: new Map(), tested: new Set() };
  for (const change of changes) {
    record(atHead, change.head);
  }
  const matched = await filesMatching(repo, head, TRANSFORM_MODEL_PATTERN, CONTENT_PATHSPECS);
  const unchanged = matched.filter((path) => !changedPaths.has(path));
  for (const file of (await classifyAt(repo, head, unchanged)).values()) {
    record(atHead, file);
  }
  return atHead;
}

// Every git call runs at the repository root, where paths from diff, status, grep and cat-file agree.
export async function planJob(
  repoPath: string,
  baseRef: string,
  headRef: string,
): Promise<JobPlan> {
  const repo = await repositoryRoot(repoPath);
  const [base, head, checkout] = await Promise.all([
    resolveCommit(repo, baseRef, "--base"),
    resolveCommit(repo, headRef, "--head"),
    checkedOutCommit(repo),
  ]);
  const forkPoint = await mergeBase(repo, base, head);
  const entries = parseNameStatus(await diffNameStatus(repo, forkPoint, head));
  const changes = await classifyChanges(repo, forkPoint, head, entries);

  const atHead = await scanHead(repo, head, changes, new Set(entries.map((entry) => entry.path)));
  const checked: CheckedTransform[] = [];
  const warnings: CiWarning[] = [];
  for (const entityId of affectedTransforms(changes)) {
    const name = atHead.names.get(entityId);
    if (name === undefined) {
      warnings.push({
        code: "missing-transform",
        message: `a changed transform test covers transform ${entityId}, which is not in the repo at ${head}`,
      });
      continue;
    }
    checked.push({ entity_id: entityId, name });
  }
  const coverage = assessCoverage({
    changes,
    transformsAtHead: atHead.names,
    testedAtHead: atHead.tested,
  });

  // Uncommitted files only matter when the checked commit is the one checked out.
  if (head === checkout) {
    const uncommitted = uncommittedContentWarning(
      parseStatusPorcelain(await statusPorcelain(repo)),
    );
    if (uncommitted !== null) {
      warnings.push(uncommitted);
    }
  }
  return { snapshot: { base, head }, checked, warnings, coverage };
}
