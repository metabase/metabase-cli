import { describe, expect, it } from "vitest";

import { ConfigError } from "@metabase/client/errors";

import type { WorktreeScope } from "../core/worktree-scope";
import { assertInWorktree, scopeBody, scopeQuery, type ScopedBody } from "./worktree-scope";

const SCOPE: WorktreeScope = { id: 3, branch: "feat/transforms" };

describe("scopeQuery", () => {
  it("names the scope's worktree so a listing returns only its rows", () => {
    expect(scopeQuery(SCOPE)).toEqual({ "worktree-id": 3 });
  });

  it("leaves the parameter unset without a scope, which is the main app's listing", () => {
    expect(scopeQuery(null)).toEqual({ "worktree-id": undefined });
  });
});

describe("assertInWorktree", () => {
  it("accepts any entity without a scope, where main-app content is the point", () => {
    expect(() => assertInWorktree("transform", 7, null, null)).not.toThrow();
  });

  it("accepts an entity tagged with the scope's worktree", () => {
    expect(() => assertInWorktree("transform", 7, 3, SCOPE)).not.toThrow();
  });

  it("refuses a main-app entity, which carries no worktree tag", () => {
    expect(() => assertInWorktree("transform", 7, null, SCOPE)).toThrow(
      new ConfigError(
        "transform 7 is not in worktree 3 (feat/transforms); refusing to touch main-app content",
      ),
    );
  });

  it("refuses an entity belonging to a different worktree", () => {
    expect(() => assertInWorktree("snippet", 12, 4, SCOPE)).toThrow(
      new ConfigError(
        "snippet 12 is not in worktree 3 (feat/transforms); refusing to touch main-app content",
      ),
    );
  });

  it("refuses an entity from a server that reports no worktree field at all", () => {
    expect(() => assertInWorktree("transform", 7, undefined, SCOPE)).toThrow(
      new ConfigError(
        "transform 7 is not in worktree 3 (feat/transforms); refusing to touch main-app content",
      ),
    );
  });
});

interface TransformBody extends ScopedBody {
  name: string;
}

describe("scopeBody", () => {
  it("returns the body untouched when there is no scope", () => {
    const body: TransformBody = { name: "daily" };
    expect(scopeBody(body, null)).toEqual({ name: "daily" });
  });

  it("injects the scope's worktree id into a body that names none", () => {
    const body: TransformBody = { name: "daily" };
    expect(scopeBody(body, SCOPE)).toEqual({ name: "daily", worktree_id: 3 });
  });

  it("accepts a body that already names the scope's own worktree", () => {
    const body: TransformBody = { name: "daily", worktree_id: 3 };
    expect(scopeBody(body, SCOPE)).toEqual({ name: "daily", worktree_id: 3 });
  });

  it("refuses a body that names a different worktree than the scope", () => {
    const body: TransformBody = { name: "daily", worktree_id: 9 };
    expect(() => scopeBody(body, SCOPE)).toThrow(
      new ConfigError(
        "body names worktree_id 9, but the active scope is worktree 3 (feat/transforms)",
      ),
    );
  });
});
