import { z } from "zod";

import {
  type ClassifiedChange,
  type ContentFile,
  type DiffEntry,
  CONTENT_FILE_EXTENSIONS,
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
  filesMatching,
  mergeBase,
  readFileAt,
  readFilesAt,
  repositoryRoot,
  resolveCommit,
  statusPorcelain,
} from "../../runtime/git";
import { parseYaml } from "../../runtime/yaml";

const CONTENT_PATHSPECS = CONTENT_FILE_EXTENSIONS.map((extension) => `*${extension}`);

export interface JobPlan {
  snapshot: Snapshot;
  checked: CheckedTransform[];
  warnings: CiWarning[];
  coverage: CoverageAssessment;
}

async function classifyAt(
  repo: string,
  commit: string,
  path: string | null,
): Promise<ContentFile | null> {
  if (path === null || !isContentPath(path)) {
    return null;
  }
  const text = await readFileAt(repo, commit, path);
  return classifyContentFile(path, parseYaml(text, z.unknown(), { source: `${commit}:${path}` }));
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

async function classifyChange(
  repo: string,
  forkPoint: string,
  head: string,
  entry: DiffEntry,
): Promise<ClassifiedChange> {
  const [baseSide, headSide] = await Promise.all([
    classifyAt(repo, forkPoint, basePath(entry)),
    classifyAt(repo, head, headPath(entry)),
  ]);
  return { base: baseSide, head: headSide };
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
  for (const [path, text] of await readFilesAt(repo, head, unchanged)) {
    record(
      atHead,
      classifyContentFile(path, parseYaml(text, z.unknown(), { source: `${head}:${path}` })),
    );
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
  const changes = await Promise.all(
    entries.map((entry) => classifyChange(repo, forkPoint, head, entry)),
  );

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
