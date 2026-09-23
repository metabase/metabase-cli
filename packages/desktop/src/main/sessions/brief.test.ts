import { describe, expect, it } from "vitest";

import type { Workspace } from "../../contracts/events";

import { sessionBrief, systemAppend } from "./brief";

const WORD_LIMIT = 200;

const WORKTREE: Workspace = {
  kind: "worktree",
  path: "/home/ada/rde-worktrees/big-orders",
  branch: "rde/big-orders",
  base: "main",
};

function words(text: string): number {
  return text.split(/\s+/u).filter((word) => word.length > 0).length;
}

describe("sessionBrief", () => {
  it("stays under the word budget the skills leave it", () => {
    expect(words(sessionBrief(WORKTREE))).toBeLessThan(WORD_LIMIT);
  });

  it("names the checkout, the schema, the entry skill, validation and the import of this branch", () => {
    const brief = sessionBrief(WORKTREE);
    for (const part of [
      "/home/ada/rde-worktrees/big-orders",
      "on branch rde/big-orders",
      "`mb db get <id> --include tables`",
      "`mb skills get core`",
      "`mb validate`",
      "`mb git-sync import --branch rde/big-orders --wait`",
    ]) {
      expect(brief).toContain(part);
    }
  });

  it("gives the import as a template on a detached checkout", () => {
    const detached: Workspace = { kind: "in-place", path: "/repo", branch: null, head: "abc123" };
    const brief = sessionBrief(detached);
    expect(brief).toContain("on a detached HEAD");
    expect(brief).toContain("`mb git-sync import --branch <branch> --wait`");
  });
});

describe("systemAppend", () => {
  it("is the brief alone for a conversation the provider still holds", () => {
    expect(systemAppend("brief", null)).toBe("brief");
  });

  it("puts a replayed transcript after the brief", () => {
    expect(systemAppend("brief", "transcript")).toBe("brief\n\ntranscript");
  });
});
