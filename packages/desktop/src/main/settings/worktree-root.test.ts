import { describe, expect, it } from "vitest";

import type { RepositorySnapshot } from "../../contracts/settings";

import { resolveWorktreeRoot } from "./worktree-root";

const HOME = "/home/dana";

const REPOSITORY: RepositorySnapshot = {
  path: "/home/dana/work/Metabase Content",
  remote: "git@github.com:acme/content.git",
  defaultBranch: "main",
  layout: "representation",
};

describe("resolveWorktreeRoot", () => {
  it("takes the path the user chose over any default", () => {
    expect(
      resolveWorktreeRoot({
        configured: "/scratch/worktrees",
        repository: REPOSITORY,
        homeDirectory: HOME,
      }),
    ).toBe("/scratch/worktrees");
  });

  it("puts each repository's checkouts under a folder named after it", () => {
    expect(
      resolveWorktreeRoot({ configured: null, repository: REPOSITORY, homeDirectory: HOME }),
    ).toBe("/home/dana/metabase-rde/worktrees/metabase-content");
  });

  it("names the shared root while no repository is chosen", () => {
    expect(resolveWorktreeRoot({ configured: null, repository: null, homeDirectory: HOME })).toBe(
      "/home/dana/metabase-rde/worktrees",
    );
  });
});
