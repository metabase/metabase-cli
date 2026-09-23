import { describe, expect, it } from "vitest";

import type { SessionIndexEntry } from "../contracts/session";

import { archivedCount, visibleSessions } from "./session-list";

const BASE: SessionIndexEntry = {
  id: "ses_1",
  title: "Clean the orders table",
  provider: "claude",
  workspace: { kind: "worktree", path: "/w/orders", branch: "rde/orders", base: "main" },
  lifecycle: "active",
  pinned: false,
  createdAt: "2026-09-22T10:00:00.000Z",
  updatedAt: "2026-09-22T10:00:00.000Z",
};

function entry(part: Partial<SessionIndexEntry>): SessionIndexEntry {
  return { ...BASE, ...part };
}

const OLDEST = entry({ id: "a", title: "Alpha", updatedAt: "2026-09-22T09:00:00.000Z" });
const NEWEST = entry({ id: "b", title: "Beta", updatedAt: "2026-09-22T12:00:00.000Z" });
const PINNED = entry({
  id: "c",
  title: "Gamma",
  updatedAt: "2026-09-22T08:00:00.000Z",
  pinned: true,
});
const ARCHIVED = entry({ id: "d", title: "Delta", lifecycle: "archived" });

const ALL = [OLDEST, NEWEST, PINNED, ARCHIVED];

function titles(sessions: readonly SessionIndexEntry[]): readonly string[] {
  return sessions.map((session) => session.title);
}

describe("the order the sidebar reads in", () => {
  it("puts pinned sessions first and the rest newest first", () => {
    expect(titles(visibleSessions(ALL, { query: "", archived: false }))).toEqual([
      "Gamma",
      "Beta",
      "Alpha",
    ]);
  });

  it("leaves archived sessions out until they are asked for", () => {
    expect(titles(visibleSessions(ALL, { query: "", archived: true }))).toEqual(["Delta"]);
  });
});

describe("searching the sidebar", () => {
  it("matches a title whatever case the user typed", () => {
    expect(titles(visibleSessions(ALL, { query: "bet", archived: false }))).toEqual(["Beta"]);
  });

  it("matches the branch a session works on", () => {
    expect(titles(visibleSessions([NEWEST], { query: "rde/ord", archived: false }))).toEqual([
      "Beta",
    ]);
  });

  it("finds nothing rather than falling back to everything", () => {
    expect(visibleSessions(ALL, { query: "nothing here", archived: false })).toEqual([]);
  });
});

describe("counting what is put away", () => {
  it("counts the archived sessions", () => {
    expect(archivedCount(ALL)).toBe(1);
  });
});
