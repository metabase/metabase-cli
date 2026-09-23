import type { DiffContext, DiffFile, FileChange } from "../../contracts/changes";
import type { ChangedFile } from "../../contracts/events";

import { GitFailure, gitText, nulFields, type Git } from "./service";

// A user's `diff.noprefix`, an external differ or a textconv filter would otherwise change what the
// app parses, so every diff names the prefixes it expects and refuses the configured helpers.
const DIFF_ARGS = [
  "--no-color",
  "--no-ext-diff",
  "--no-textconv",
  "--src-prefix=a/",
  "--dst-prefix=b/",
  "-M",
];

const BINARY_COUNT = "-";
const NUMSTAT_RECORD = /^(\d+|-)\t(\d+|-)\t(.*)$/;

const WHOLE_FILE_CONTEXT_LINES = 1_000_000;

const CONTEXT_ARGS: Readonly<Record<DiffContext, readonly string[]>> = {
  hunks: [],
  file: [`-U${WHOLE_FILE_CONTEXT_LINES}`],
};

interface NumstatRecord {
  readonly path: string;
  readonly added: number;
  readonly removed: number;
  readonly binary: boolean;
}

interface NumstatFields {
  readonly added: string;
  readonly removed: string;
  readonly inlinePath: string;
}

function numstatFields(record: string): NumstatFields {
  const [, added, removed, inlinePath] = NUMSTAT_RECORD.exec(record) ?? [];
  if (added === undefined || removed === undefined || inlinePath === undefined) {
    throw new GitFailure(`git printed a numstat record it does not document: ${record}`);
  }
  return { added, removed, inlinePath };
}

// A binary file has no line counts; git prints `-` for both and the app reports zero lines changed
// with the flag that says why, rather than inventing a number.
function numstatRecord(fields: NumstatFields, path: string): NumstatRecord {
  const binary = fields.added === BINARY_COUNT;
  return {
    path,
    added: binary ? 0 : Number(fields.added),
    removed: binary ? 0 : Number(fields.removed),
    binary,
  };
}

export function parseNumstat(stdout: string): NumstatRecord[] {
  const records = nulFields(stdout);
  const parsed: NumstatRecord[] = [];
  let index = 0;
  while (index < records.length) {
    const record = records[index];
    if (record === undefined) {
      break;
    }
    const fields = numstatFields(record);
    // A rename prints an empty path in the record and the old and new names in the two that follow.
    if (fields.inlinePath.length > 0) {
      parsed.push(numstatRecord(fields, fields.inlinePath));
      index += 1;
      continue;
    }
    const renamed = records[index + 2];
    if (renamed === undefined) {
      throw new GitFailure(`git printed a rename with no destination: ${record}`);
    }
    parsed.push(numstatRecord(fields, renamed));
    index += 3;
  }
  return parsed;
}

interface StatusRecord {
  readonly path: string;
  readonly previousPath: string | null;
  readonly change: FileChange;
}

// A type change (a file becoming a symlink) is still the same path with different content, so it
// reads as a modification.
const STATUS_LETTERS: Readonly<Record<string, FileChange>> = {
  A: "added",
  M: "modified",
  T: "modified",
  D: "deleted",
  R: "renamed",
};

export function parseNameStatus(stdout: string): StatusRecord[] {
  const records = nulFields(stdout);
  const parsed: StatusRecord[] = [];
  let index = 0;
  while (index < records.length) {
    const letters = records[index];
    if (letters === undefined) {
      break;
    }
    const change = STATUS_LETTERS[letters.charAt(0)];
    const path = records[index + 1];
    if (change === undefined || path === undefined) {
      throw new GitFailure(`git printed a name-status record it does not document: ${letters}`);
    }
    if (change !== "renamed") {
      parsed.push({ path, previousPath: null, change });
      index += 2;
      continue;
    }
    const destination = records[index + 2];
    if (destination === undefined) {
      throw new GitFailure(`git printed a rename with no destination: ${letters}`);
    }
    parsed.push({ path: destination, previousPath: path, change });
    index += 3;
  }
  return parsed;
}

export function joinDiffFiles(
  statuses: readonly StatusRecord[],
  counts: readonly NumstatRecord[],
): DiffFile[] {
  const byPath = new Map(counts.map((record) => [record.path, record]));
  return statuses.map((status) => {
    const counted = byPath.get(status.path);
    if (counted === undefined) {
      throw new GitFailure(`git named ${status.path} in the status but not in the line counts.`);
    }
    return {
      path: status.path,
      previousPath: status.previousPath,
      change: status.change,
      added: counted.added,
      removed: counted.removed,
      binary: counted.binary,
    };
  });
}

export async function diffStat(
  git: Git,
  cwd: string,
  from: string,
  to: string,
): Promise<ChangedFile[]> {
  const outcome = await git.read(cwd, ["diff", "--numstat", "-z", ...DIFF_ARGS, from, to]);
  return parseNumstat(gitText(outcome)).map(({ path, added, removed }) => ({
    path,
    added,
    removed,
  }));
}

interface DiffRange {
  readonly from: string;
  readonly to: string;
  readonly ignoreWhitespace: boolean;
  readonly context: DiffContext;
}

function rangeArgs(range: DiffRange): string[] {
  const whitespace = range.ignoreWhitespace ? ["--ignore-all-space"] : [];
  return [...DIFF_ARGS, ...whitespace, range.from, range.to];
}

export async function diffFiles(git: Git, cwd: string, range: DiffRange): Promise<DiffFile[]> {
  const args = rangeArgs(range);
  const statuses = await git.read(cwd, ["diff", "--name-status", "-z", ...args]);
  const counts = await git.read(cwd, ["diff", "--numstat", "-z", ...args]);
  return joinDiffFiles(parseNameStatus(gitText(statuses)), parseNumstat(gitText(counts)));
}

export async function diffPatch(git: Git, cwd: string, range: DiffRange): Promise<string> {
  const outcome = await git.read(cwd, [
    "diff",
    "--patch",
    ...CONTEXT_ARGS[range.context],
    ...rangeArgs(range),
  ]);
  return gitText(outcome);
}
