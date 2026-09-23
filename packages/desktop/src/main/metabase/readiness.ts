import type { BranchStatus } from "../../contracts/changes";
import { assertNever } from "../../contracts/assert-never";
import type { ConnectionState } from "../../contracts/connection";
import type { SyncReadiness } from "../../contracts/metabase";

// Metabase's own default for `remote-sync-branch`, and the name older repositories use, so either is
// treated as the branch reviewers merge into even when the instance has not said which it tracks.
const TRACKED_BRANCH_NAMES: ReadonlySet<string> = new Set(["main", "master"]);

const NOT_CONNECTED_REASON = "Connect to Metabase in Settings to sync.";

// The instance's own state, with its reason, is at the top of the panel; this line says only what
// it means for syncing.
const SIGNED_OUT_REASON = "Sign in to Metabase again to sync.";
const UNREACHABLE_REASON = "Can't reach Metabase. Sync once it's back.";
const NO_REMOTE_SYNC_REASON =
  "Remote sync isn't enabled on this instance, so this branch can't be imported into it.";

export interface ReadinessInput {
  readonly connection: ConnectionState;
  readonly branch: BranchStatus;
  readonly hasRemote: boolean;
  readonly trackedBranch: string | null;
}

function guardFor(branch: string, trackedBranch: string | null): string | null {
  if (branch !== trackedBranch && !TRACKED_BRANCH_NAMES.has(branch)) {
    return null;
  }
  return `${branch} is the branch the instance tracks, so importing it replaces what everyone on this Metabase sees with this session's work.`;
}

function needsPush(branch: BranchStatus): boolean {
  const upstream = branch.upstream;
  return upstream.kind !== "tracking" || upstream.divergence.ahead > 0;
}

function connectionReason(connection: ConnectionState): string | null {
  switch (connection.kind) {
    case "disconnected": {
      return NOT_CONNECTED_REASON;
    }
    case "signed-out": {
      return SIGNED_OUT_REASON;
    }
    case "stale": {
      return UNREACHABLE_REASON;
    }
    case "connected": {
      return connection.server.features.remoteSync ? null : NO_REMOTE_SYNC_REASON;
    }
    default: {
      return assertNever(connection);
    }
  }
}

export function syncReadiness(input: ReadinessInput): SyncReadiness {
  const connectionProblem = connectionReason(input.connection);
  if (connectionProblem !== null) {
    return { kind: "blocked", reason: connectionProblem };
  }
  const name = input.branch.branch;
  if (name === null) {
    return {
      kind: "blocked",
      reason: "No branch is checked out, so there's nothing to sync.",
    };
  }
  if (!input.branch.clean) {
    return {
      kind: "blocked",
      reason: "Commit the changes first. Metabase imports what's pushed.",
    };
  }
  if (!input.hasRemote) {
    return {
      kind: "blocked",
      reason: "Add an origin remote to sync.",
    };
  }
  const upstream = input.branch.upstream;
  if (upstream.kind === "tracking" && upstream.divergence.behind > 0) {
    return {
      kind: "blocked",
      reason: `${upstream.divergence.against} has ${upstream.divergence.behind} commits this branch lacks; bring them in before syncing.`,
    };
  }
  return {
    kind: "ready",
    branch: name,
    push: needsPush(input.branch),
    guard: guardFor(name, input.trackedBranch),
  };
}
