import { assertNever } from "../../contracts/assert-never";
import type { BranchStatus, Divergence } from "../../contracts/changes";

const DETACHED_LABEL = "detached HEAD";

export function branchLabel(status: BranchStatus): string {
  return status.branch ?? DETACHED_LABEL;
}

// The upstream is named for its remote alone, because the branch beside it already says which
// branch it is.
function remoteOf(ref: string): string {
  const slash = ref.indexOf("/");
  return slash === -1 ? ref : ref.slice(0, slash);
}

function divergencePhrase(divergence: Divergence, target: string): string {
  const { ahead, behind } = divergence;
  if (ahead === 0 && behind === 0) {
    return `even with ${target}`;
  }
  if (behind === 0) {
    return `${String(ahead)} ahead of ${target}`;
  }
  if (ahead === 0) {
    return `${String(behind)} behind ${target}`;
  }
  return `${String(ahead)} ahead, ${String(behind)} behind ${target}`;
}

// Being even with the base changes nothing a person can do, so it goes unsaid.
function withBase(status: BranchStatus, lead: string): string {
  const base = status.base;
  if (base === null || (base.ahead === 0 && base.behind === 0)) {
    return lead;
  }
  return `${lead} · ${divergencePhrase(base, base.against)}`;
}

export function syncLine(status: BranchStatus): string {
  const upstream = status.upstream;
  switch (upstream.kind) {
    case "tracking": {
      const divergence = upstream.divergence;
      const remote = remoteOf(divergence.against);
      return divergence.ahead === 0 && divergence.behind === 0
        ? `up to date with ${remote}`
        : divergencePhrase(divergence, remote);
    }
    case "gone": {
      return withBase(status, `gone from ${remoteOf(upstream.name)}`);
    }
    case "none": {
      return withBase(status, "not pushed");
    }
    default: {
      return assertNever(upstream);
    }
  }
}

// An import applies the branch as it stands, so work that reached the base after the branch left
// it would be missing from Metabase until the branch takes it in.
export function baseMovedNote(status: BranchStatus): string | null {
  const base = status.base;
  if (base === null || base.behind === 0) {
    return null;
  }
  const commits = base.behind === 1 ? "1 commit" : `${String(base.behind)} commits`;
  return `${base.against} has ${commits} this branch doesn't. Merge them in before you sync.`;
}

export function commitBlocker(status: BranchStatus): string | null {
  if (status.branch === null) {
    return "No branch is checked out.";
  }
  return status.clean ? "Nothing to commit." : null;
}

export function pushBlocker(status: BranchStatus): string | null {
  if (status.branch === null) {
    return "No branch is checked out.";
  }
  if (status.upstream.kind === "tracking" && status.upstream.divergence.ahead === 0) {
    return "Everything is pushed.";
  }
  return null;
}

export function pullRequestBlocker(status: BranchStatus): string | null {
  return status.pullRequest.kind === "unavailable" ? status.pullRequest.reason : null;
}

export const BRANCH_ACTIONS = ["commit", "push", "pull-request"] as const;
export type BranchAction = (typeof BRANCH_ACTIONS)[number];

export interface OfferedAction {
  readonly action: BranchAction;
  readonly blocker: string | null;
}

// `primary` is the one step the branch is waiting for; `more` holds the others, each with what
// stops it, so every action stays one menu away.
export interface BranchActions {
  readonly primary: BranchAction | null;
  readonly more: readonly OfferedAction[];
}

// A branch the remote never saw is due a push only once it holds a commit its base lacks; pushing
// an empty branch opens nothing to review.
function pushDue(status: BranchStatus): boolean {
  const upstream = status.upstream;
  switch (upstream.kind) {
    case "tracking": {
      return upstream.divergence.ahead > 0;
    }
    case "gone": {
      return true;
    }
    case "none": {
      return status.base === null || status.base.ahead > 0;
    }
    default: {
      return assertNever(upstream);
    }
  }
}

type ActionRule = (status: BranchStatus) => boolean;

const BLOCKERS = {
  commit: commitBlocker,
  push: pushBlocker,
  "pull-request": pullRequestBlocker,
} as const satisfies Record<BranchAction, (status: BranchStatus) => string | null>;

const DUE = {
  commit: () => true,
  push: pushDue,
  "pull-request": () => true,
} as const satisfies Record<BranchAction, ActionRule>;

export function branchActions(status: BranchStatus): BranchActions {
  const offered = BRANCH_ACTIONS.map((action) => ({ action, blocker: BLOCKERS[action](status) }));
  const lead = offered.find((entry) => entry.blocker === null && DUE[entry.action](status));
  const primary = lead === undefined ? null : lead.action;
  return { primary, more: offered.filter((entry) => entry.action !== primary) };
}
