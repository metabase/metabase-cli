import { InternalError, ValidationError } from "@metabase/client/errors";

import {
  type ClassifiedChange,
  type ContentFile,
  type DiffEntry,
  CONTENT_TOP_LEVEL_FOLDERS,
  TRANSFORM_MODEL_PATTERN,
  affectedTransforms,
  classifyContentFile,
  headTransforms,
  isContentPath,
  noContentChangesWarning,
  parseNameStatus,
  parseStatusPorcelain,
  uncommittedContentWarning,
  unreadContentWarning,
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

interface ReadFile {
  kind: "read";
  file: ContentFile;
}

interface UnreadFile {
  kind: "unread";
  error: ValidationError;
}

type FileReading = ReadFile | UnreadFile;

function unread(commit: string, path: string, message: string): UnreadFile {
  const source = `${commit}:${path}`;
  return { kind: "unread", error: new ValidationError(message, { source, zodIssues: [] }) };
}

// Reads and classifies the content files among `paths` at one commit, in one batch. A file this
// check cannot read is answered with the reason, for the caller to refuse or to skip.
async function readAt(
  repo: string,
  commit: string,
  paths: readonly string[],
  signal: AbortSignal,
): Promise<Map<string, FileReading>> {
  const content = paths.filter(isContentPath);
  const readings = new Map<string, FileReading>();
  if (content.length === 0) {
    return readings;
  }
  const modes = await fileModesAt(repo, commit, signal);
  const readable: string[] = [];
  for (const path of content) {
    const mode = modes.get(path);
    if (mode === undefined) {
      throw new InternalError(`git listed ${path} at ${commit}, but its tree does not hold it`);
    }
    if (!FILE_MODES.has(mode)) {
      const reason = `${commit}:${path} is not a regular file (git mode ${mode}): Metabase would import what it points to, which this check cannot read; commit the file itself`;
      readings.set(path, unread(commit, path, reason));
    } else if (path.includes("\n")) {
      const reason = `${commit}:${JSON.stringify(path)}: a path with a newline cannot be read; rename the file`;
      readings.set(path, unread(commit, path, reason));
    } else {
      readable.push(path);
    }
  }
  for (const [path, text] of await readFilesAt(repo, commit, readable, signal)) {
    try {
      const file = classifyContentFile(path, parseMetabaseYaml(text, `${commit}:${path}`));
      readings.set(path, { kind: "read", file });
    } catch (error) {
      if (!(error instanceof ValidationError)) {
        throw error;
      }
      readings.set(path, { kind: "unread", error });
    }
  }
  return readings;
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

interface ClassifiedHead {
  changes: ClassifiedChange[];
  // The files at head the diff does not name, which the change cannot have broken.
  unchangedAtHead: ContentFile[];
  unreadUnchanged: ValidationError[];
}

function readingOf(
  readings: ReadonlyMap<string, FileReading>,
  path: string | null,
): FileReading | null {
  if (path === null || !isContentPath(path)) {
    return null;
  }
  const reading = readings.get(path);
  if (reading === undefined) {
    throw new InternalError(`${path} was not read, though git names it`);
  }
  return reading;
}

// A head side this check cannot read stops the job: the change made it. A base side it cannot read
// counts as absent, so a branch that repairs such a file on main is judged by its head side alone.
function headSide(reading: FileReading | null): ContentFile | null {
  if (reading?.kind === "unread") {
    throw reading.error;
  }
  return reading === null ? null : reading.file;
}

function baseSide(reading: FileReading | null): ContentFile | null {
  return reading?.kind === "read" ? reading.file : null;
}

// One read at each side: the changed files, and at head also every unchanged file whose text names a
// Transform model, which the coverage check counts.
async function classifyChanges(
  repo: string,
  forkPoint: string,
  head: string,
  entries: readonly DiffEntry[],
  signal: AbortSignal,
): Promise<ClassifiedHead> {
  const changedPaths = new Set(entries.map((entry) => entry.path));
  const matched = await filesMatching(
    repo,
    head,
    TRANSFORM_MODEL_PATTERN,
    CONTENT_PATHSPECS,
    signal,
  );
  const unchanged = matched.filter((path) => !changedPaths.has(path));
  const [baseReadings, headReadings] = await Promise.all([
    readAt(repo, forkPoint, present(entries.map(basePath)), signal),
    readAt(repo, head, [...present(entries.map(headPath)), ...unchanged], signal),
  ]);
  const changes = entries.map((entry) => ({
    path: entry.path,
    base: baseSide(readingOf(baseReadings, basePath(entry))),
    head: headSide(readingOf(headReadings, headPath(entry))),
  }));
  const unchangedAtHead: ContentFile[] = [];
  const unreadUnchanged: ValidationError[] = [];
  for (const path of unchanged) {
    const reading = readingOf(headReadings, path);
    if (reading?.kind === "read") {
      unchangedAtHead.push(reading.file);
    } else if (reading?.kind === "unread") {
      unreadUnchanged.push(reading.error);
    }
  }
  return { changes, unchangedAtHead, unreadUnchanged };
}

// Every git call runs at the repository root, where paths from diff, status, grep and cat-file agree.
export async function planJob(
  repoPath: string,
  baseRef: string,
  headRef: string,
  signal: AbortSignal,
): Promise<JobPlan> {
  const repo = await repositoryRoot(repoPath, signal);
  const [base, head, checkout] = await Promise.all([
    resolveCommit(repo, baseRef, "--base", signal),
    resolveCommit(repo, headRef, "--head", signal),
    checkedOutCommit(repo, signal),
  ]);
  const forkPoint = await mergeBase(repo, base, head, signal);
  const entries = parseNameStatus(await diffNameStatus(repo, forkPoint, head, signal));
  const { changes, unchangedAtHead, unreadUnchanged } = await classifyChanges(
    repo,
    forkPoint,
    head,
    entries,
    signal,
  );
  const atHead = headTransforms([...changes.map((change) => change.head), ...unchangedAtHead]);
  const checked: CheckedTransform[] = [];
  const warnings: CiWarning[] = [];
  for (const warning of [
    noContentChangesWarning(entries),
    unreadContentWarning(unreadUnchanged.map((error) => error.message)),
  ]) {
    if (warning !== null) {
      warnings.push(warning);
    }
  }
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
    untestableAtHead: atHead.untestable,
  });

  // Uncommitted files only matter when the checked commit is the one checked out.
  if (head === checkout) {
    const uncommitted = uncommittedContentWarning(
      parseStatusPorcelain(await statusPorcelain(repo, signal)),
    );
    if (uncommitted !== null) {
      warnings.push(uncommitted);
    }
  }
  return { snapshot: { base, head }, checked, warnings, coverage };
}
