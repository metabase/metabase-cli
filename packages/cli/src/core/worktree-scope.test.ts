import { describe, expect, it } from "vitest";

import { ConfigError } from "@metabase/client/errors";

import {
  describeScopeSource,
  mainOnlyRefusal,
  parseWorktreeRef,
  resolveScopeSource,
  type WorktreeScope,
  type WorktreeScopeInput,
} from "./worktree-scope";

const PIN: WorktreeScope = { id: 3, branch: "feat/transforms" };

function inputWith(
  flag: string | undefined,
  env: string | undefined,
  pin: WorktreeScope | null,
): WorktreeScopeInput {
  return { profile: "default", flag, env, pin };
}

describe("parseWorktreeRef", () => {
  it("reads an all-digit value as a worktree id", () => {
    expect(parseWorktreeRef("12", "--worktree")).toEqual({ kind: "id", id: 12 });
  });

  it("reads a non-numeric value as a branch name", () => {
    expect(parseWorktreeRef("feat/transforms", "--worktree")).toEqual({
      kind: "branch",
      branch: "feat/transforms",
    });
  });

  it("trims surrounding whitespace before deciding which kind it is", () => {
    expect(parseWorktreeRef("  7  ", "--worktree")).toEqual({ kind: "id", id: 7 });
  });

  it("rejects a blank value, naming the source it came from", () => {
    expect(() => parseWorktreeRef("   ", "MB_WORKTREE")).toThrow(
      new ConfigError("invalid MB_WORKTREE: value must not be blank"),
    );
  });

  it("rejects id 0, which no worktree can have", () => {
    expect(() => parseWorktreeRef("0", "--worktree")).toThrow(
      new ConfigError("invalid --worktree: 0 (must be ≥ 1)"),
    );
  });
});

describe("resolveScopeSource", () => {
  it("returns null when nothing names a worktree", () => {
    expect(resolveScopeSource(inputWith(undefined, undefined, null))).toBeNull();
  });

  it("prefers the flag over the environment", () => {
    expect(resolveScopeSource(inputWith("5", "9", null))).toEqual({
      ref: { kind: "id", id: 5 },
      origin: "flag",
      scope: null,
    });
  });

  it("falls back to the environment when no flag is given", () => {
    expect(resolveScopeSource(inputWith(undefined, "feat/x", null))).toEqual({
      ref: { kind: "branch", branch: "feat/x" },
      origin: "env",
      scope: null,
    });
  });

  it("treats an empty flag as unset and falls through to the environment", () => {
    expect(resolveScopeSource(inputWith("", "9", null))).toEqual({
      ref: { kind: "id", id: 9 },
      origin: "env",
      scope: null,
    });
  });

  it("resolves a pinned profile without a ref to look up", () => {
    expect(resolveScopeSource(inputWith(undefined, undefined, PIN))).toEqual({
      ref: { kind: "id", id: 3 },
      origin: "pin",
      scope: PIN,
    });
  });

  it("accepts a flag that re-states the pinned worktree by id", () => {
    expect(resolveScopeSource(inputWith("3", undefined, PIN))).toEqual({
      ref: { kind: "id", id: 3 },
      origin: "flag",
      scope: PIN,
    });
  });

  it("accepts an environment value that re-states the pinned worktree by branch", () => {
    expect(resolveScopeSource(inputWith(undefined, "feat/transforms", PIN))).toEqual({
      ref: { kind: "branch", branch: "feat/transforms" },
      origin: "env",
      scope: PIN,
    });
  });

  it("refuses a flag naming a different worktree than the pin", () => {
    expect(() => resolveScopeSource(inputWith("9", undefined, PIN))).toThrow(
      new ConfigError(
        'profile "default" is pinned to worktree 3 (feat/transforms); refusing --worktree 9',
      ),
    );
  });

  it("refuses an environment value naming a different branch than the pin", () => {
    expect(() => resolveScopeSource(inputWith(undefined, "other", PIN))).toThrow(
      new ConfigError(
        'profile "default" is pinned to worktree 3 (feat/transforms); refusing MB_WORKTREE "other"',
      ),
    );
  });
});

describe("describeScopeSource", () => {
  it("names both halves of a pinned scope", () => {
    expect(describeScopeSource({ ref: { kind: "id", id: 3 }, origin: "pin", scope: PIN })).toBe(
      "worktree 3 (feat/transforms) from the profile pin",
    );
  });

  it("falls back to the raw ref for a scope that has not been looked up yet", () => {
    expect(
      describeScopeSource({
        ref: { kind: "branch", branch: "feat/x" },
        origin: "env",
        scope: null,
      }),
    ).toBe('worktree "feat/x" from MB_WORKTREE');
  });
});

describe("mainOnlyRefusal", () => {
  it("names the command, the scope, and both ways out", () => {
    expect(
      mainOnlyRefusal("transform run", {
        ref: { kind: "id", id: 3 },
        origin: "pin",
        scope: PIN,
      }),
    ).toBe(
      "transform run is not available inside a worktree (scope: worktree 3 (feat/transforms) " +
        "from the profile pin); it changes main-app content. Unpin the profile " +
        "(`mb worktree unpin`) or drop MB_WORKTREE to run it against the main app.",
    );
  });
});
