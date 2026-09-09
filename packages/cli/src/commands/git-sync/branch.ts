import type { MetabaseClient } from "@metabase/client/client";
import { ConfigError } from "@metabase/client/errors";

import type { WorktreeScope } from "../../core/worktree-scope";

export const BRANCH_PINNED_REFUSAL = "a worktree is pinned to its branch; drop --branch";
export const BRANCH_UNSET_REFUSAL = "remote-sync-branch is not set; configure git-sync first";

interface SyncBranchInput {
  scope: WorktreeScope | null;
  flag: string | undefined;
  tracked: string | null;
}

// `branch` is where the content moves, `expected` the branch the caller believes the scope is on:
// the server compares `expected` against the scope's own branch and refuses the request outright
// when they disagree, so pointing `--branch` elsewhere in the main app still has to state the
// tracked branch as the one being left.
interface SyncBranchTarget {
  branch: string;
  expected: string;
}

export function syncBranchTarget(input: SyncBranchInput): SyncBranchTarget {
  const stated = input.flag === undefined || input.flag === "" ? null : input.flag;
  if (input.scope !== null) {
    if (stated !== null) {
      throw new ConfigError(BRANCH_PINNED_REFUSAL);
    }
    return { branch: input.scope.branch, expected: input.scope.branch };
  }
  if (input.tracked === null) {
    throw new ConfigError(BRANCH_UNSET_REFUSAL);
  }
  return { branch: stated ?? input.tracked, expected: input.tracked };
}

// A worktree carries its branch, so only the main app has to read the setting — and reading it
// under a scope would fail on an instance that never configured one.
export async function resolveSyncBranch(
  mb: MetabaseClient,
  scope: WorktreeScope | null,
  flag: string | undefined,
): Promise<SyncBranchTarget> {
  const tracked = scope === null ? await mb.gitSync.branch() : null;
  return syncBranchTarget({ scope, flag, tracked });
}
