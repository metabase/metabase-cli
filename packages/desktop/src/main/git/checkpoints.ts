import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

import type { ChangedFile } from "../../contracts/events";

import { diffStat } from "./diff";
import { firstLine, gitText, type Git } from "./service";

export const CHECKPOINT_REF_PREFIX = "refs/rde/checkpoints";

// A checkpoint is plumbing the user never authored, so it carries the app's name rather than
// borrowing the identity their own commits are signed with.
const CHECKPOINT_IDENTITY = {
  GIT_AUTHOR_NAME: "RDE",
  GIT_AUTHOR_EMAIL: "rde@metabase.com",
  GIT_COMMITTER_NAME: "RDE",
  GIT_COMMITTER_EMAIL: "rde@metabase.com",
} as const;

// A user's fsmonitor daemon tracks their own index and must not be consulted for the private one.
const INDEX_ARGS = ["-c", "core.fsmonitor=false"];

export function checkpointRef(sessionId: string, seq: number): string {
  return `${CHECKPOINT_REF_PREFIX}/${sessionId}/${seq}`;
}

export function checkpointNamespace(sessionId: string): string {
  return `${CHECKPOINT_REF_PREFIX}/${sessionId}`;
}

interface CheckpointCaptured {
  readonly kind: "captured";
  readonly ref: string;
  readonly files: readonly ChangedFile[];
}

interface CheckpointFailed {
  readonly kind: "failed";
  readonly message: string;
}

export type CheckpointOutcome = CheckpointCaptured | CheckpointFailed;

export interface CaptureRequest {
  readonly git: Git;
  readonly cwd: string;
  readonly sessionId: string;
  readonly seq: number;
  readonly previousRef: string | null;
}

async function commonDirectory(git: Git, cwd: string): Promise<string> {
  const outcome = await git.read(cwd, ["rev-parse", "--git-common-dir"]);
  const named = firstLine(gitText(outcome));
  if (named === null) {
    throw new Error(`git named no common directory for ${cwd}`);
  }
  return isAbsolute(named) ? named : resolve(cwd, named);
}

interface TreeWritten {
  readonly kind: "written";
  readonly tree: string;
}

interface TreeFailed {
  readonly kind: "failed";
  readonly message: string;
}

type TreeOutcome = TreeWritten | TreeFailed;

// Written through a private index so the user's staging area is untouched.
export async function writeCheckoutTree(git: Git, cwd: string): Promise<TreeOutcome> {
  const common = await commonDirectory(git, cwd);
  const indexPath = resolve(common, `rde-checkpoint-index-${randomUUID()}`);
  const indexed = git.withEnv({ GIT_INDEX_FILE: indexPath });
  try {
    // A repository with no commit yet has no HEAD to seed the index from, and git refusing here is
    // the answer: `add -A` then stages the whole checkout into an empty index, which is correct.
    const seeded = await indexed.write(cwd, [...INDEX_ARGS, "read-tree", "HEAD"]);
    if (seeded.kind === "unavailable") {
      return { kind: "failed", message: seeded.message };
    }
    const staged = await indexed.write(cwd, [...INDEX_ARGS, "add", "-A", "--", "."]);
    if (staged.kind !== "answered") {
      return { kind: "failed", message: staged.message };
    }
    const written = await indexed.write(cwd, [...INDEX_ARGS, "write-tree"]);
    if (written.kind !== "answered") {
      return { kind: "failed", message: written.message };
    }
    const tree = firstLine(written.stdout);
    if (tree === null) {
      return { kind: "failed", message: "git write-tree named no tree for the checkout." };
    }
    return { kind: "written", tree };
  } finally {
    // A forced termination leaves git's own lock beside the index, and it would poison the next
    // capture at the same path.
    await rm(indexPath, { force: true });
    await rm(`${indexPath}.lock`, { force: true });
  }
}

export async function captureCheckpoint(request: CaptureRequest): Promise<CheckpointOutcome> {
  const written = await writeCheckoutTree(request.git, request.cwd);
  if (written.kind === "failed") {
    return written;
  }
  const git = request.git.withEnv(CHECKPOINT_IDENTITY);
  const ref = checkpointRef(request.sessionId, request.seq);
  const parent = request.previousRef === null ? [] : ["-p", request.previousRef];
  const message = `rde checkpoint ${request.sessionId} ${request.seq}`;
  const committed = await git.write(request.cwd, [
    "commit-tree",
    written.tree,
    ...parent,
    "-m",
    message,
  ]);
  if (committed.kind !== "answered") {
    return { kind: "failed", message: committed.message };
  }
  const commit = firstLine(committed.stdout);
  if (commit === null) {
    return { kind: "failed", message: "git commit-tree named no commit for the checkpoint." };
  }
  const published = await git.write(request.cwd, ["update-ref", ref, commit]);
  if (published.kind !== "answered") {
    return { kind: "failed", message: published.message };
  }
  const files =
    request.previousRef === null
      ? []
      : await diffStat(request.git, request.cwd, request.previousRef, ref);
  return { kind: "captured", ref, files };
}

export async function deleteCheckpoints(git: Git, cwd: string, sessionId: string): Promise<void> {
  const listed = await git.read(cwd, [
    "for-each-ref",
    "--format=%(refname)",
    checkpointNamespace(sessionId),
  ]);
  if (listed.kind !== "answered") {
    return;
  }
  const refs = listed.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  for (const ref of refs) {
    await git.write(cwd, ["update-ref", "-d", ref]);
  }
}

const SEQ_PATTERN = /^\d+$/;

export function checkpointSeq(sessionId: string, ref: string): number | null {
  const prefix = `${checkpointNamespace(sessionId)}/`;
  if (!ref.startsWith(prefix)) {
    return null;
  }
  const seq = ref.slice(prefix.length);
  return SEQ_PATTERN.test(seq) ? Number(seq) : null;
}
