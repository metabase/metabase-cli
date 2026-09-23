import { describe, expect, it } from "vitest";

import type { BranchStatus } from "../../contracts/changes";

import { baseMovedNote, branchActions, commitBlocker, pushBlocker, syncLine } from "./branch";

const UNPUSHED: BranchStatus = {
  branch: "rde/clean-orders",
  upstream: { kind: "none" },
  base: { against: "main", ahead: 2, behind: 0 },
  clean: false,
  ownBranch: true,
  pullRequest: {
    kind: "unavailable",
    reason: "Push rde/clean-orders before opening a pull request.",
  },
};

const PUSHED: BranchStatus = {
  ...UNPUSHED,
  upstream: {
    kind: "tracking",
    divergence: { against: "origin/rde/clean-orders", ahead: 0, behind: 0 },
  },
  clean: true,
};

describe("syncLine", () => {
  it("compares a branch that was never pushed with its base", () => {
    expect(syncLine(UNPUSHED)).toBe("not pushed · 2 ahead of main");
  });

  it("leaves out a base the branch has not moved from", () => {
    expect(syncLine({ ...UNPUSHED, base: { against: "main", ahead: 0, behind: 0 } })).toBe(
      "not pushed",
    );
  });

  it("names only the remote of a pushed branch that matches its upstream", () => {
    expect(syncLine(PUSHED)).toBe("up to date with origin");
  });

  it("counts both ways when the branch and its upstream have each moved", () => {
    expect(
      syncLine({
        ...PUSHED,
        upstream: {
          kind: "tracking",
          divergence: { against: "origin/rde/clean-orders", ahead: 1, behind: 2 },
        },
      }),
    ).toBe("1 ahead, 2 behind origin");
  });
});

describe("syncLine for a deleted upstream", () => {
  it("says the upstream is gone rather than that the branch was never pushed", () => {
    expect(
      syncLine({ ...UNPUSHED, upstream: { kind: "gone", name: "origin/rde/clean-orders" } }),
    ).toBe("gone from origin · 2 ahead of main");
  });
});

describe("baseMovedNote", () => {
  it("says nothing while the branch holds every commit of its base", () => {
    expect(baseMovedNote(PUSHED)).toBe(null);
  });

  it("counts the base's new commits and says what syncing without them does", () => {
    expect(
      baseMovedNote({ ...PUSHED, base: { against: "origin/main", ahead: 2, behind: 3 } }),
    ).toBe("origin/main has 3 commits this branch doesn't. Merge them in before you sync.");
  });
});

describe("commitBlocker", () => {
  it("lets a checkout with changes commit and stops a clean one", () => {
    expect(commitBlocker(UNPUSHED)).toBeNull();
    expect(commitBlocker(PUSHED)).toBe("Nothing to commit.");
  });
});

describe("pushBlocker", () => {
  it("lets an unpushed branch push and stops one whose commits are all on the remote", () => {
    expect(pushBlocker(UNPUSHED)).toBeNull();
    expect(pushBlocker(PUSHED)).toBe("Everything is pushed.");
  });

  it("stops a detached HEAD, which has no branch to push", () => {
    expect(pushBlocker({ ...UNPUSHED, branch: null })).toBe("No branch is checked out.");
  });
});

const ORIGIN_ON_GITHUB = "https://github.com/metabase/rde-demo/compare/main...rde/clean-orders";

describe("branchActions", () => {
  it("leads with commit while the checkout has changes", () => {
    expect(branchActions(UNPUSHED)).toEqual({
      primary: "commit",
      more: [
        { action: "push", blocker: null },
        {
          action: "pull-request",
          blocker: "Push rde/clean-orders before opening a pull request.",
        },
      ],
    });
  });

  it("leads with push once the commits are made and the remote lacks them", () => {
    expect(branchActions({ ...UNPUSHED, clean: true }).primary).toBe("push");
  });

  it("leads with push again after the remote refused one", () => {
    const refused: BranchStatus = {
      ...PUSHED,
      upstream: {
        kind: "tracking",
        divergence: { against: "origin/rde/clean-orders", ahead: 1, behind: 0 },
      },
    };
    expect(branchActions(refused).primary).toBe("push");
  });

  it("leads with the pull request once every commit is pushed", () => {
    expect(
      branchActions({ ...PUSHED, pullRequest: { kind: "ready", url: ORIGIN_ON_GITHUB } }),
    ).toEqual({
      primary: "pull-request",
      more: [
        { action: "commit", blocker: "Nothing to commit." },
        { action: "push", blocker: "Everything is pushed." },
      ],
    });
  });

  it("leads with nothing on a fresh branch that holds no commit of its own", () => {
    const fresh: BranchStatus = {
      ...UNPUSHED,
      clean: true,
      base: { against: "main", ahead: 0, behind: 0 },
    };
    expect(branchActions(fresh)).toEqual({
      primary: null,
      more: [
        { action: "commit", blocker: "Nothing to commit." },
        { action: "push", blocker: null },
        {
          action: "pull-request",
          blocker: "Push rde/clean-orders before opening a pull request.",
        },
      ],
    });
  });

  it("leads with nothing on a pushed branch whose remote has no pull request page", () => {
    expect(branchActions(PUSHED).primary).toBeNull();
  });

  it("leads with nothing on a detached HEAD and says why each action is stopped", () => {
    expect(branchActions({ ...UNPUSHED, branch: null })).toEqual({
      primary: null,
      more: [
        { action: "commit", blocker: "No branch is checked out." },
        { action: "push", blocker: "No branch is checked out." },
        {
          action: "pull-request",
          blocker: "Push rde/clean-orders before opening a pull request.",
        },
      ],
    });
  });
});
