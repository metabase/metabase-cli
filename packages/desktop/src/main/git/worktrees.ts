import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { errorMessage } from "@metabase/client/errors";

import { branchExists, type Git } from "./service";
import { readDivergence, readPorcelainStatus } from "./status";

const ORIGIN = "origin";

interface WorktreeCreated {
  readonly kind: "created";
  readonly path: string;
  readonly fetched: boolean;
  readonly fetchMessage: string | null;
}

interface WorktreeRefused {
  readonly kind: "refused";
  readonly message: string;
}

export type WorktreeOutcome = WorktreeCreated | WorktreeRefused;

export interface WorktreeRequest {
  readonly git: Git;
  readonly root: string;
  readonly worktreeRoot: string;
  readonly slug: string;
  readonly branch: string;
  readonly base: string;
}

export async function createWorktree(request: WorktreeRequest): Promise<WorktreeOutcome> {
  const { git, root, branch, base } = request;
  try {
    await mkdir(request.worktreeRoot, { recursive: true });
  } catch (error) {
    return {
      kind: "refused",
      message: `${request.worktreeRoot} could not be created: ${errorMessage(error)}`,
    };
  }

  if (await branchExists(git, root, branch)) {
    return {
      kind: "refused",
      message: `The branch ${branch} already exists. Pick another name for this session.`,
    };
  }

  const fetch = await git.read(root, ["fetch", "--quiet", ORIGIN]);
  const fetched = fetch.kind === "answered";
  const fetchMessage = fetched ? null : fetch.message;

  const baseCommit = await git.read(root, ["rev-parse", "--verify", `${base}^{commit}`]);
  if (baseCommit.kind !== "answered") {
    return {
      kind: "refused",
      message: `${base} names no commit in this repository, so there is nothing to branch from.`,
    };
  }

  const path = join(request.worktreeRoot, request.slug);
  // A directory removed without `git worktree remove` leaves a registration that makes a later
  // `worktree add` refuse the path.
  await git.write(root, ["worktree", "prune"]);
  const added = await git.write(root, ["worktree", "add", "-b", branch, path, base]);
  if (added.kind !== "answered") {
    return { kind: "refused", message: added.message };
  }
  return { kind: "created", path, fetched, fetchMessage };
}

interface WorktreeRemoved {
  readonly kind: "removed";
}

interface WorktreeKept {
  readonly kind: "kept";
  readonly reason: string;
}

export type RemovalOutcome = WorktreeRemoved | WorktreeKept;

export interface RemovalRequest {
  readonly git: Git;
  readonly root: string;
  readonly path: string;
  readonly branch: string;
  readonly base: string;
  readonly sharedWith: number;
}

export async function removeWorktree(request: RemovalRequest): Promise<RemovalOutcome> {
  const { git, root, branch, base } = request;
  if (request.sharedWith > 0) {
    return {
      kind: "kept",
      reason: `${request.sharedWith} other session works in this checkout.`,
    };
  }
  if (!(await readPorcelainStatus(git, request.path)).clean) {
    return { kind: "kept", reason: "The checkout has changes that are not committed." };
  }
  const divergence = await readDivergence(git, root, base, branch);
  if (divergence === null) {
    return {
      kind: "kept",
      reason: `${base} names no commit, so the app cannot tell what ${branch} holds.`,
    };
  }
  const ahead = divergence.ahead;
  if (ahead > 0) {
    return {
      kind: "kept",
      reason: `${branch} is ${ahead} commit${ahead === 1 ? "" : "s"} ahead of ${base}.`,
    };
  }
  const removed = await git.write(root, ["worktree", "remove", request.path]);
  if (removed.kind !== "answered") {
    return { kind: "kept", reason: removed.message };
  }
  const deleted = await git.write(root, ["branch", "-D", branch]);
  if (deleted.kind !== "answered") {
    return { kind: "kept", reason: deleted.message };
  }
  return { kind: "removed" };
}
