import type { MetabaseClient } from "@metabase/client/client";
import type { Worktree } from "@metabase/client/domain/worktree";
import { ConfigError } from "@metabase/client/errors";

import {
  formatWorktreeRef,
  type WorktreeRef,
  type WorktreeScope,
  type WorktreeScopeSource,
} from "../core/worktree-scope";

// The label a parse error names when the ref came from a positional argument rather than a flag.
export const WORKTREE_REF_LABEL = "worktree ref";

// The sentence every scoped command appends to its `details`, so `--help` on any of them says how
// to reach a worktree without the reader having to find `mb worktree` first.
export const WORKTREE_SCOPE_DETAIL =
  "Pass --worktree <id|branch> (or set MB_WORKTREE, or pin the profile with `mb worktree pin`) to operate inside a git-sync worktree.";

export async function findWorktree(ref: WorktreeRef, mb: MetabaseClient): Promise<Worktree> {
  if (ref.kind === "id") {
    return mb.gitSync.getWorktree(ref.id);
  }
  const { data } = await mb.gitSync.worktrees();
  const match = data.find((worktree) => worktree.branch === ref.branch);
  if (match === undefined) {
    throw new ConfigError(`worktree ${formatWorktreeRef(ref)} not found; run \`mb worktree list\``);
  }
  return match;
}

export async function resolveWorktreeScope(
  source: WorktreeScopeSource,
  mb: MetabaseClient,
): Promise<WorktreeScope> {
  if (source.scope !== null) {
    return source.scope;
  }
  const worktree = await findWorktree(source.ref, mb);
  return { id: worktree.id, branch: worktree.branch };
}

// The query parameter every scoped read carries. Metabase spells it `worktree-id` on a query
// string and `worktree_id` in a body, and both names are used verbatim.
interface WorktreeScopeQuery {
  "worktree-id"?: number | undefined;
}

export function scopeQuery(scope: WorktreeScope | null): WorktreeScopeQuery {
  return { "worktree-id": scope === null ? undefined : scope.id };
}

// An entity fetched by id ignores the scope — the server answers for an admin whatever worktree the
// row belongs to — so a scoped command has to compare the row's own tag before touching it.
export function assertInWorktree(
  kind: string,
  id: number | string,
  worktreeId: number | null | undefined,
  scope: WorktreeScope | null,
): void {
  if (scope === null || worktreeId === scope.id) {
    return;
  }
  throw new ConfigError(
    `${kind} ${id} is not in worktree ${scope.id} (${scope.branch}); refusing to touch main-app content`,
  );
}

export interface ScopedBody {
  worktree_id?: number | null | undefined;
}

export function scopeBody<T extends ScopedBody>(body: T, scope: WorktreeScope | null): T {
  if (scope === null) {
    return body;
  }
  const stated = body.worktree_id;
  if (stated !== undefined && stated !== null && stated !== scope.id) {
    throw new ConfigError(
      `body names worktree_id ${stated}, but the active scope is worktree ${scope.id} (${scope.branch})`,
    );
  }
  return { ...body, worktree_id: scope.id };
}
