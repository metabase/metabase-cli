import { describe, expect, it } from "vitest";

import type { BranchStatus } from "../../contracts/changes";
import type { ConnectionState } from "../../contracts/connection";

import { syncReadiness, type ReadinessInput } from "./readiness";

const CONNECTED: ConnectionState = {
  kind: "connected",
  url: "http://metabase.test",
  user: { id: 1, name: "Ada", email: "ada@example.com", isSuperuser: true },
  server: {
    version: "v1.60.0",
    edition: "ee",
    features: { remoteSync: true, transforms: true, transformTests: true },
  },
  connectedAt: "2026-09-22T10:00:00.000Z",
};

const PUSHED: BranchStatus = {
  branch: "rde/big-orders",
  upstream: {
    kind: "tracking",
    divergence: { against: "origin/rde/big-orders", ahead: 0, behind: 0 },
  },
  base: { against: "main", ahead: 1, behind: 0 },
  clean: true,
  ownBranch: true,
  pullRequest: { kind: "unavailable", reason: "no remote page" },
};

const READY_INPUT: ReadinessInput = {
  connection: CONNECTED,
  branch: PUSHED,
  hasRemote: true,
  trackedBranch: "main",
};

describe("syncReadiness", () => {
  it("is ready without a push for a clean branch the remote already holds", () => {
    expect(syncReadiness(READY_INPUT)).toEqual({
      kind: "ready",
      branch: "rde/big-orders",
      push: false,
      guard: null,
    });
  });

  it("pushes first when the branch has commits the remote lacks", () => {
    const ahead: BranchStatus = {
      ...PUSHED,
      upstream: {
        kind: "tracking",
        divergence: { against: "origin/rde/big-orders", ahead: 2, behind: 0 },
      },
    };
    expect(syncReadiness({ ...READY_INPUT, branch: ahead })).toEqual({
      kind: "ready",
      branch: "rde/big-orders",
      push: true,
      guard: null,
    });
  });

  it("pushes first when the branch was never pushed or its remote branch is gone", () => {
    for (const upstream of [
      { kind: "none" },
      { kind: "gone", name: "origin/rde/big-orders" },
    ] satisfies BranchStatus["upstream"][]) {
      expect(syncReadiness({ ...READY_INPUT, branch: { ...PUSHED, upstream } })).toEqual({
        kind: "ready",
        branch: "rde/big-orders",
        push: true,
        guard: null,
      });
    }
  });

  it("asks for confirmation before importing the branch the instance tracks", () => {
    const tracked: BranchStatus = { ...PUSHED, branch: "release" };
    expect(syncReadiness({ ...READY_INPUT, branch: tracked, trackedBranch: "release" })).toEqual({
      kind: "ready",
      branch: "release",
      push: false,
      guard:
        "release is the branch the instance tracks, so importing it replaces what everyone on this Metabase sees with this session's work.",
    });
  });

  it("guards main even when the instance names no tracked branch", () => {
    const main: BranchStatus = { ...PUSHED, branch: "main" };
    expect(syncReadiness({ ...READY_INPUT, branch: main, trackedBranch: null })).toEqual({
      kind: "ready",
      branch: "main",
      push: false,
      guard:
        "main is the branch the instance tracks, so importing it replaces what everyone on this Metabase sees with this session's work.",
    });
  });

  it("refuses a checkout with uncommitted changes", () => {
    expect(syncReadiness({ ...READY_INPUT, branch: { ...PUSHED, clean: false } })).toEqual({
      kind: "blocked",
      reason: "Commit the changes first. Metabase imports what's pushed.",
    });
  });

  it("refuses a detached HEAD", () => {
    expect(syncReadiness({ ...READY_INPUT, branch: { ...PUSHED, branch: null } })).toEqual({
      kind: "blocked",
      reason: "No branch is checked out, so there's nothing to sync.",
    });
  });

  it("refuses a repository with no remote to push to", () => {
    expect(syncReadiness({ ...READY_INPUT, hasRemote: false })).toEqual({
      kind: "blocked",
      reason: "Add an origin remote to sync.",
    });
  });

  it("refuses a branch behind its remote, which a push would not fix", () => {
    const behind: BranchStatus = {
      ...PUSHED,
      upstream: {
        kind: "tracking",
        divergence: { against: "origin/rde/big-orders", ahead: 1, behind: 3 },
      },
    };
    expect(syncReadiness({ ...READY_INPUT, branch: behind })).toEqual({
      kind: "blocked",
      reason:
        "origin/rde/big-orders has 3 commits this branch lacks; bring them in before syncing.",
    });
  });

  it("refuses when no Metabase is connected, and says what signing in again is for", () => {
    expect(syncReadiness({ ...READY_INPUT, connection: { kind: "disconnected" } })).toEqual({
      kind: "blocked",
      reason: "Connect to Metabase in Settings to sync.",
    });
    const signedOut: ConnectionState = {
      kind: "signed-out",
      url: CONNECTED.url,
      user: CONNECTED.user,
      reason: "Metabase refused the refresh token. Sign in again.",
    };
    expect(syncReadiness({ ...READY_INPUT, connection: signedOut })).toEqual({
      kind: "blocked",
      reason: "Sign in to Metabase again to sync.",
    });
  });

  it("refuses a Metabase that does not offer remote sync", () => {
    const withoutSync: ConnectionState = {
      ...CONNECTED,
      server: {
        ...CONNECTED.server,
        features: { remoteSync: false, transforms: true, transformTests: true },
      },
    };
    expect(syncReadiness({ ...READY_INPUT, connection: withoutSync })).toEqual({
      kind: "blocked",
      reason:
        "Remote sync isn't enabled on this instance, so this branch can't be imported into it.",
    });
  });
});
