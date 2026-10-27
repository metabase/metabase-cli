import { InternalError, ValidationError } from "@metabase/client/errors";

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
  fileModesAt,
  filesContaining,
  mergeBase,
  readFilesAt,
  repositoryRoot,
  resolveCommit,
  statusPorcelain,
} from "../../runtime/git";
import { parseMetabaseYaml } from "../../runtime/yaml";

const CONTENT_PATHSPECS = CONTENT_FILE_EXTENSIONS.map((extension) => `*${extension}`);

interface JobPlan {
  snapshot: Snapshot;
  checked: CheckedTransform[];
  warnings: CiWarning[];
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
    base: sideOf(baseFiles, basePath(entry)),
    head: sideOf(headFiles, headPath(entry)),
  }));
}

async function findTransform(
  repo: string,
  head: string,
  entityId: string,
): Promise<CheckedTransform | null> {
  const hits = await filesContaining(repo, head, `entity_id: ${entityId}`, CONTENT_PATHSPECS);
  for (const file of (await classifyAt(repo, head, hits)).values()) {
    if (file.kind === "transform" && file.entityId === entityId) {
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
  const changes = await classifyChanges(repo, forkPoint, head, entries);

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
