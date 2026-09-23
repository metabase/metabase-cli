import { SyncImportResult } from "@metabase/client/domain/git-sync";
import { errorMessage } from "@metabase/client/errors";

import { assertNever } from "../../contracts/assert-never";
import type { ConnectionState } from "../../contracts/connection";
import { WorktreeEnsured, type MetabaseWorktree } from "../../contracts/metabase";
import type { Session } from "../../contracts/session";
import type { MetabaseCli } from "../cli/runner";
import { readCheckout, type Git } from "../git/service";

const ABSENT: MetabaseWorktree = { kind: "absent" };
const ORIGIN = "origin";

// `cwd` is any directory that exists: ensuring and deleting a worktree read no checkout, and a
// session being deleted may have lost its own.
interface WorktreeDeps {
  readonly cli: MetabaseCli;
  readonly git: Git;
  readonly connection: () => ConnectionState;
  readonly cwd: string;
  readonly log: (message: string) => void;
}

// A worktree belongs to one instance and one branch, so a session that moves to another of either
// asks again.
interface Ensuring {
  readonly url: string;
  readonly branch: string;
  readonly worktree: Promise<MetabaseWorktree>;
}

// The CLI a session's Metabase calls run through, carrying its worktree when it has one.
export interface WorktreeScope {
  readonly worktree: MetabaseWorktree;
  readonly cli: MetabaseCli;
}

// A signed-out connection keeps no server summary, and the sync line already asks to sign in.
export function offersRemoteSync(connection: ConnectionState): boolean {
  return remoteSyncUrl(connection) !== null;
}

function remoteSyncUrl(connection: ConnectionState): string | null {
  switch (connection.kind) {
    case "connected":
    case "stale": {
      return connection.server.features.remoteSync ? connection.url : null;
    }
    case "disconnected":
    case "signed-out": {
      return null;
    }
    default: {
      return assertNever(connection);
    }
  }
}

// The one place that knows a session's Metabase worktree. `ensure` is idempotent on the server, so
// the id is held in memory and asked for again after a restart rather than stored. A failure is held
// like an id, so the app's calls and the agent it already started agree on where the session works
// until the instance or the branch changes.
export class MetabaseWorktrees {
  private readonly ensured = new Map<string, Ensuring>();

  constructor(private readonly deps: WorktreeDeps) {}

  async scope(session: Session): Promise<WorktreeScope> {
    const worktree = await this.worktree(session);
    return { worktree, cli: this.deps.cli.inWorktree(worktree) };
  }

  // Another session on the same branch works in the same worktree, so it outlives this one. A
  // failure is logged and never stops the session's own removal.
  async remove(session: Session, otherBranches: ReadonlySet<string>): Promise<void> {
    try {
      const worktree = await this.worktree(session);
      this.ensured.delete(session.id);
      if (worktree.kind !== "ready" || otherBranches.has(worktree.branch)) {
        return;
      }
      const args = ["git-sync", "worktree", "delete", String(worktree.id)];
      const deleted = await this.deps.cli.complete(this.deps.cwd, args);
      if (deleted.kind === "failed") {
        this.deps.log(
          `session ${session.id}: worktree ${worktree.id} was kept: ${deleted.message}`,
        );
      }
    } catch (error) {
      this.deps.log(`session ${session.id}: its worktree was kept: ${errorMessage(error)}`);
    }
  }

  async worktree(session: Session): Promise<MetabaseWorktree> {
    const url = remoteSyncUrl(this.deps.connection());
    if (url === null) {
      return ABSENT;
    }
    const branch = await this.branchOf(session);
    if (branch === null) {
      return ABSENT;
    }
    const held = this.ensured.get(session.id);
    if (held !== undefined && held.url === url && held.branch === branch) {
      return held.worktree;
    }
    const worktree = this.ensure(session, branch);
    this.ensured.set(session.id, { url, branch, worktree });
    return worktree;
  }

  // An in-place session started on a detached checkout takes the branch it is on once there is one.
  private async branchOf(session: Session): Promise<string | null> {
    const workspace = session.workspace;
    if (workspace.branch !== null) {
      return workspace.branch;
    }
    return (await readCheckout(this.deps.git, workspace.path)).branch;
  }

  // A worktree holds only what it imported from its branch on the remote, so the branch is pushed
  // first and imported once the worktree exists: the session opens on the content its checkout has.
  private async ensure(session: Session, branch: string): Promise<MetabaseWorktree> {
    const sessionId = session.id;
    const args = ["git-sync", "worktree", "ensure", "--branch", branch];
    try {
      const published = await this.publish(session.workspace.path, branch);
      if (published !== null) {
        this.deps.log(`session ${sessionId}: ${branch} is not on ${ORIGIN}: ${published}`);
      }
      const ensured = await this.deps.cli.run(this.deps.cwd, args, WorktreeEnsured);
      if (ensured.kind === "answered") {
        const worktree: MetabaseWorktree = {
          kind: "ready",
          id: ensured.value.id,
          branch: ensured.value.branch,
        };
        if (published === null) {
          await this.fill(sessionId, worktree);
        }
        return worktree;
      }
      this.deps.log(`session ${sessionId}: no worktree for ${branch}: ${ensured.message}`);
      return { kind: "failed", message: ensured.message };
    } catch (error) {
      const message = errorMessage(error);
      this.deps.log(`session ${sessionId}: no worktree for ${branch}: ${message}`);
      return { kind: "failed", message };
    }
  }

  // Null once the remote holds the branch, else why it does not. A branch already there is left
  // alone: what it gains later reaches the remote through the sync.
  private async publish(checkout: string, branch: string): Promise<string | null> {
    const ref = `refs/heads/${branch}`;
    const listed = await this.deps.git.read(checkout, ["ls-remote", "--heads", ORIGIN, ref]);
    if (listed.kind !== "answered") {
      return listed.message;
    }
    if (listed.stdout.trim().length > 0) {
      return null;
    }
    const pushed = await this.deps.git.write(checkout, ["push", "--set-upstream", ORIGIN, branch]);
    return pushed.kind === "answered" ? null : pushed.message;
  }

  // An import that fails leaves the worktree standing and empty; the next sync imports again.
  private async fill(sessionId: string, worktree: MetabaseWorktree): Promise<void> {
    const cli = this.deps.cli.inWorktree(worktree);
    const imported = await cli.run(this.deps.cwd, ["git-sync", "import"], SyncImportResult);
    if (imported.kind === "failed") {
      this.deps.log(`session ${sessionId}: the worktree imported nothing: ${imported.message}`);
    }
  }
}
