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
import type { CheckedTransform, CiWarning, Snapshot } from "../../core/ci-events";
import {
  checkedOutCommit,
  diffNameStatus,
  filesContaining,
  mergeBase,
  readFileAt,
  repositoryRoot,
  resolveCommit,
  statusPorcelain,
} from "../../runtime/git";
import { parseYaml } from "../../runtime/yaml";

const CONTENT_PATHSPECS = CONTENT_FILE_EXTENSIONS.map((extension) => `*${extension}`);

interface JobPlan {
  snapshot: Snapshot;
  checked: CheckedTransform[];
  warnings: CiWarning[];
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

async function findTransform(
  repo: string,
  head: string,
  entityId: string,
): Promise<CheckedTransform | null> {
  for (const path of await filesContaining(
    repo,
    head,
    `entity_id: ${entityId}`,
    CONTENT_PATHSPECS,
  )) {
    const file = await classifyAt(repo, head, path);
    if (file?.kind === "transform" && file.entityId === entityId) {
      return { entity_id: entityId, name: file.name };
    }
  }
  return null;
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

  const namesAtHead = new Map<string, string>();
  for (const { head: headSide } of changes) {
    if (headSide?.kind === "transform") {
      namesAtHead.set(headSide.entityId, headSide.name);
    }
  }

  const checked: CheckedTransform[] = [];
  const warnings: CiWarning[] = [];
  for (const entityId of affectedTransforms(changes)) {
    const name = namesAtHead.get(entityId);
    if (name !== undefined) {
      checked.push({ entity_id: entityId, name });
      continue;
    }
    const transform = await findTransform(repo, head, entityId);
    if (transform === null) {
      warnings.push({
        code: "missing-transform",
        message: `a changed transform test covers transform ${entityId}, which is not in the repo at ${head}`,
      });
      continue;
    }
    checked.push(transform);
  }

  // Uncommitted files only matter when the checked commit is the one checked out.
  if (head === checkout) {
    const uncommitted = uncommittedContentWarning(
      parseStatusPorcelain(await statusPorcelain(repo)),
    );
    if (uncommitted !== null) {
      warnings.push(uncommitted);
    }
  }
  return { snapshot: { base, head }, checked, warnings };
}
