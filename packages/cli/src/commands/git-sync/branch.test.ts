import { describe, expect, it } from "vitest";

import { ConfigError } from "@metabase/client/errors";

import type { WorktreeScope } from "../../core/worktree-scope";

import { BRANCH_PINNED_REFUSAL, BRANCH_UNSET_REFUSAL, syncBranchTarget } from "./branch";

const SCOPE: WorktreeScope = { id: 3, branch: "feat/transforms" };

describe("syncBranchTarget", () => {
  it("uses the worktree's own branch as both the target and the branch left behind", () => {
    expect(syncBranchTarget({ scope: SCOPE, flag: undefined, tracked: "main" })).toEqual({
      branch: "feat/transforms",
      expected: "feat/transforms",
    });
  });

  it("refuses --branch inside a worktree, which is bound to one branch for life", () => {
    expect(() => syncBranchTarget({ scope: SCOPE, flag: "other", tracked: null })).toThrow(
      new ConfigError(BRANCH_PINNED_REFUSAL),
    );
  });

  it("falls back to the tracked branch in the main app", () => {
    expect(syncBranchTarget({ scope: null, flag: undefined, tracked: "main" })).toEqual({
      branch: "main",
      expected: "main",
    });
  });

  it("retargets the main app with --branch while still stating the tracked branch", () => {
    expect(syncBranchTarget({ scope: null, flag: "release", tracked: "main" })).toEqual({
      branch: "release",
      expected: "main",
    });
  });

  it("treats an empty --branch as unstated", () => {
    expect(syncBranchTarget({ scope: null, flag: "", tracked: "main" })).toEqual({
      branch: "main",
      expected: "main",
    });
  });

  it("refuses a main-app sync on an instance with no branch configured", () => {
    expect(() => syncBranchTarget({ scope: null, flag: undefined, tracked: null })).toThrow(
      new ConfigError(BRANCH_UNSET_REFUSAL),
    );
  });
});
