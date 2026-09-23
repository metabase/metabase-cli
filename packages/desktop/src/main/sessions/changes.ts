import { access, rm } from "node:fs/promises";
import { isAbsolute, join, normalize, sep } from "node:path";

import { isFileNotFoundError } from "@metabase/client/errors";

import type {
  ActionOutcome,
  BranchStatus,
  ChangeScope,
  ChangeSet,
  ChangesRequest,
  CommitRequest,
  DiffFile,
  FileRef,
  PullRequestOutcome,
  PullRequestTarget,
  PushRequest,
  RevertRequest,
} from "../../contracts/changes";
import type { Workspace } from "../../contracts/events";
import type { FilePreview, SessionTree } from "../../contracts/files";
import type { SessionSnapshot } from "../../contracts/session";
import type { RepositorySnapshot } from "../../contracts/settings";
import { checkpointRef, checkpointSeq, writeCheckoutTree } from "../git/checkpoints";
import { diffFiles, diffPatch } from "../git/diff";
import { pushRefusalMessage } from "../git/push";
import { pullRequestUrl, remoteLocation } from "../git/remote";
import {
  GitFailure,
  TRACKED_FILE_LIMIT,
  firstLine,
  listCheckoutFiles,
  type Git,
} from "../git/service";
import { comparisonBase, readDivergence, readPorcelainStatus } from "../git/status";

import { SessionCommandError } from "./errors";
import { readPreview } from "./preview";

const ORIGIN = "origin";
const BASELINE_SEQ = 0;
const PARENT_SEGMENT = "..";

const IN_PLACE_RESTORE_MESSAGE =
  "Only a session in its own worktree can restore its files; this one works in the repository.";

interface ChangesDeps {
  readonly git: Git;
  readonly open: (sessionId: string) => Promise<SessionSnapshot>;
  readonly repository: () => RepositorySnapshot | null;
  readonly openUrl: (url: string) => Promise<boolean>;
  readonly openFile: (path: string) => Promise<ActionOutcome>;
  readonly publishPush: (sessionId: string, text: string) => void;
}

// `from` is the ref the session's changes are read against, so a deleted file's text is still at it.
export interface ChangedFiles {
  readonly from: string;
  readonly files: readonly DiffFile[];
}

interface DiffEnds {
  readonly from: string;
  readonly to: string;
}

function checkoutPath(path: string): string {
  const normalized = normalize(path);
  const escapes = normalized === PARENT_SEGMENT || normalized.startsWith(`${PARENT_SEGMENT}${sep}`);
  if (isAbsolute(path) || escapes) {
    throw new SessionCommandError(`${path} is not a path inside the session's checkout.`);
  }
  return normalized;
}

function turnCheckpoint(snapshot: SessionSnapshot, turnId: string): string {
  const item = snapshot.items.find(
    (candidate) => candidate.kind === "checkpoint" && candidate.turnId === turnId,
  );
  if (item === undefined || item.kind !== "checkpoint") {
    throw new SessionCommandError(`Turn ${turnId} has no checkpoint to show changes against.`);
  }
  return item.ref;
}

function requireSeq(sessionId: string, ref: string): number {
  const seq = checkpointSeq(sessionId, ref);
  if (seq === null) {
    throw new SessionCommandError(`${ref} is not a checkpoint of this session.`);
  }
  return seq;
}

function outcomeOf(result: Promise<void>): Promise<ActionOutcome> {
  return result.then(
    (): ActionOutcome => ({ kind: "done" }),
    (error: unknown): ActionOutcome => {
      if (error instanceof GitFailure || error instanceof SessionCommandError) {
        return { kind: "refused", message: error.message };
      }
      throw error;
    },
  );
}

function baseOf(workspace: Workspace, repository: RepositorySnapshot | null): string | null {
  if (workspace.kind === "worktree") {
    return workspace.base;
  }
  return repository === null ? null : repository.defaultBranch;
}

async function checkoutTree(git: Git, cwd: string): Promise<string> {
  const written = await writeCheckoutTree(git, cwd);
  if (written.kind === "failed") {
    throw new GitFailure(written.message);
  }
  return written.tree;
}

async function gitWrite(git: Git, cwd: string, args: readonly string[]): Promise<void> {
  const outcome = await git.write(cwd, args);
  if (outcome.kind !== "answered") {
    throw new GitFailure(outcome.message);
  }
}

// Ignored files are neither captured nor touched, so this is never a blanket clean.
export async function restoreCheckout(
  git: Git,
  workspace: Workspace,
  sessionId: string,
  ref: string,
): Promise<void> {
  if (workspace.kind === "in-place") {
    throw new SessionCommandError(IN_PLACE_RESTORE_MESSAGE);
  }
  requireSeq(sessionId, ref);
  const now = await checkoutTree(git, workspace.path);
  const files = await diffFiles(git, workspace.path, {
    from: ref,
    to: now,
    ignoreWhitespace: false,
    context: "hunks",
  });
  for (const file of files) {
    if (file.change === "added" || file.change === "renamed") {
      await rm(join(workspace.path, file.path), { force: true });
    }
  }
  await gitWrite(git, workspace.path, ["restore", `--source=${ref}`, "--worktree", "--", "."]);
}

async function folderExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return false;
    }
    throw error;
  }
}

// A session outlives its folder: a deleted worktree keeps the conversation, and every reader of the
// checkout says so instead of running git in a directory that is not there.
export async function presentCheckout(snapshot: SessionSnapshot): Promise<string> {
  const path = snapshot.session.workspace.path;
  if (!(await folderExists(path))) {
    throw new SessionCommandError(
      `This session's folder, ${path}, is gone. The conversation is kept, but its files can't be read.`,
    );
  }
  return path;
}

export class SessionChanges {
  constructor(private readonly deps: ChangesDeps) {}

  async read(request: ChangesRequest): Promise<ChangeSet> {
    const snapshot = await this.openCheckout(request.sessionId);
    const cwd = snapshot.session.workspace.path;
    const ends = await this.ends(snapshot, request.scope);
    const range = {
      ...ends,
      ignoreWhitespace: request.ignoreWhitespace,
      context: request.context,
    };
    const files = await diffFiles(this.deps.git, cwd, range);
    const patch = await diffPatch(this.deps.git, cwd, range);
    return { from: ends.from, files, patch };
  }

  // The files the whole session changed, without their patch, and the ref they are compared to.
  async files(sessionId: string): Promise<ChangedFiles> {
    return this.changedFiles(await this.openCheckout(sessionId));
  }

  async tree(sessionId: string): Promise<SessionTree> {
    const snapshot = await this.openCheckout(sessionId);
    const cwd = snapshot.session.workspace.path;
    const listed = await listCheckoutFiles(this.deps.git, cwd, TRACKED_FILE_LIMIT);
    const changed = await this.changedFiles(snapshot);
    return { ...listed, changed: [...changed.files] };
  }

  async preview(request: FileRef): Promise<FilePreview> {
    const snapshot = await this.openCheckout(request.sessionId);
    return readPreview(snapshot.session.workspace.path, checkoutPath(request.path));
  }

  // Only the working tree is written, so the user's staging area stays as they arranged it.
  revert(request: RevertRequest): Promise<ActionOutcome> {
    return outcomeOf(this.revertFile(request));
  }

  async status(sessionId: string): Promise<BranchStatus> {
    const snapshot = await this.openCheckout(sessionId);
    const workspace = snapshot.session.workspace;
    const cwd = workspace.path;
    const porcelain = await readPorcelainStatus(this.deps.git, cwd);
    const baseName = baseOf(workspace, this.deps.repository());
    const branch = porcelain.branch;
    const compared =
      baseName === null || branch === null || baseName === branch
        ? null
        : await comparisonBase(this.deps.git, cwd, baseName);
    const base =
      compared === null || branch === null
        ? null
        : await readDivergence(this.deps.git, cwd, compared, branch);
    return {
      branch,
      upstream: porcelain.upstream,
      base,
      clean: porcelain.clean,
      ownBranch: workspace.kind === "worktree" && branch === workspace.branch,
      pullRequest: await this.pullRequestTarget(
        cwd,
        branch,
        base === null ? null : baseName,
        porcelain.upstream.kind === "tracking",
      ),
    };
  }

  commit(request: CommitRequest): Promise<ActionOutcome> {
    return outcomeOf(this.commitAll(request));
  }

  push(request: PushRequest): Promise<ActionOutcome> {
    return this.pushStreaming(request, (text) => {
      this.deps.publishPush(request.sessionId, text);
    });
  }

  pushStreaming(request: PushRequest, onOutput: (text: string) => void): Promise<ActionOutcome> {
    return outcomeOf(this.pushBranch(request, onOutput));
  }

  async openPullRequest(sessionId: string): Promise<PullRequestOutcome> {
    const status = await this.status(sessionId);
    if (status.pullRequest.kind === "unavailable") {
      return { kind: "refused", message: status.pullRequest.reason };
    }
    const url = status.pullRequest.url;
    const opened = await this.deps.openUrl(url);
    if (!opened) {
      return { kind: "refused", message: `No browser opened ${url}.` };
    }
    return { kind: "opened", url };
  }

  async openFile(request: FileRef): Promise<ActionOutcome> {
    const snapshot = await this.openCheckout(request.sessionId);
    const path = join(snapshot.session.workspace.path, checkoutPath(request.path));
    return this.deps.openFile(path);
  }

  private async changedFiles(snapshot: SessionSnapshot): Promise<ChangedFiles> {
    const ends = await this.ends(snapshot, { kind: "all" });
    const range = { ...ends, ignoreWhitespace: false, context: "hunks" } as const;
    const files = await diffFiles(this.deps.git, snapshot.session.workspace.path, range);
    return { from: ends.from, files };
  }

  // The session's whole change is the checkout as it stands against the baseline, captured the way
  // a checkpoint is: new files the agent has not staged are part of it, ignored ones are not.
  private async ends(snapshot: SessionSnapshot, scope: ChangeScope): Promise<DiffEnds> {
    const sessionId = snapshot.session.id;
    if (scope.kind === "all") {
      const now = await checkoutTree(this.deps.git, snapshot.session.workspace.path);
      return { from: checkpointRef(sessionId, BASELINE_SEQ), to: now };
    }
    const to = turnCheckpoint(snapshot, scope.turnId);
    const seq = requireSeq(sessionId, to);
    return { from: checkpointRef(sessionId, seq - 1), to };
  }

  private async revertFile(request: RevertRequest): Promise<void> {
    const snapshot = await this.openCheckout(request.sessionId);
    requireSeq(request.sessionId, request.ref);
    const cwd = snapshot.session.workspace.path;
    const paths = [request.path, request.previousPath].filter((path) => path !== null);
    for (const path of paths.map(checkoutPath)) {
      if (await this.existsAt(cwd, request.ref, path)) {
        await gitWrite(this.deps.git, cwd, [
          "restore",
          `--source=${request.ref}`,
          "--worktree",
          "--",
          path,
        ]);
      } else {
        await rm(join(cwd, path), { force: true });
      }
    }
  }

  private async existsAt(cwd: string, ref: string, path: string): Promise<boolean> {
    const outcome = await this.deps.git.read(cwd, ["cat-file", "-e", `${ref}:${path}`]);
    if (outcome.kind === "unavailable") {
      throw new GitFailure(outcome.message);
    }
    return outcome.kind === "answered";
  }

  private async commitAll(request: CommitRequest): Promise<void> {
    const snapshot = await this.openCheckout(request.sessionId);
    const cwd = snapshot.session.workspace.path;
    await gitWrite(this.deps.git, cwd, ["add", "-A"]);
    await gitWrite(this.deps.git, cwd, ["commit", "--quiet", "-m", request.message]);
  }

  private async pushBranch(request: PushRequest, onOutput: (text: string) => void): Promise<void> {
    const status = await this.status(request.sessionId);
    if (status.branch === null) {
      throw new SessionCommandError("No branch is checked out, so there's nothing to push.");
    }
    if (request.mode === "force-with-lease" && !status.ownBranch) {
      throw new SessionCommandError(
        `${status.branch} wasn't created by RDE, so it won't be force-pushed.`,
      );
    }
    const snapshot = await this.openCheckout(request.sessionId);
    const force = request.mode === "force-with-lease" ? ["--force-with-lease"] : [];
    const outcome = await this.deps.git.stream(
      snapshot.session.workspace.path,
      ["push", "--progress", ...force, "--set-upstream", ORIGIN, status.branch],
      onOutput,
    );
    if (outcome.kind === "refused") {
      throw new SessionCommandError(pushRefusalMessage(status.branch, outcome.message));
    }
    if (outcome.kind === "unavailable") {
      throw new GitFailure(outcome.message);
    }
  }

  private async openCheckout(sessionId: string): Promise<SessionSnapshot> {
    const snapshot = await this.deps.open(sessionId);
    await presentCheckout(snapshot);
    return snapshot;
  }

  private async pullRequestTarget(
    cwd: string,
    branch: string | null,
    base: string | null,
    pushed: boolean,
  ): Promise<PullRequestTarget> {
    if (branch === null) {
      return { kind: "unavailable", reason: "No branch is checked out." };
    }
    if (base === null) {
      return { kind: "unavailable", reason: `${branch} has no base branch to compare against.` };
    }
    const remote = await this.deps.git.read(cwd, ["remote", "get-url", ORIGIN]);
    const remoteUrl = remote.kind === "answered" ? firstLine(remote.stdout) : null;
    if (remoteUrl === null) {
      return { kind: "unavailable", reason: "The repository has no origin remote." };
    }
    const location = remoteLocation(remoteUrl);
    if (location === null) {
      return {
        kind: "unavailable",
        reason: `${remoteUrl} is not on GitHub or GitLab, so there is no pull request page to open.`,
      };
    }
    if (!pushed) {
      return { kind: "unavailable", reason: `Push ${branch} before opening a pull request.` };
    }
    return { kind: "ready", url: pullRequestUrl(location, base, branch) };
  }
}
