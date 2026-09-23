import { describe, expect, it } from "vitest";

import type { SessionIndexEntry } from "../contracts/session";

import { movedSelection, paletteItems } from "./palette";

const ORDERS: SessionIndexEntry = {
  id: "ses_orders",
  title: "Clean the orders table",
  provider: "claude",
  workspace: { kind: "worktree", path: "/w/orders", branch: "rde/orders", base: "main" },
  lifecycle: "active",
  pinned: false,
  createdAt: "2026-09-22T10:00:00.000Z",
  updatedAt: "2026-09-22T10:00:00.000Z",
};

const REVENUE: SessionIndexEntry = {
  ...ORDERS,
  id: "ses_revenue",
  title: "A revenue metric",
  workspace: { kind: "in-place", path: "/repo", branch: "main", head: null },
  updatedAt: "2026-09-22T11:00:00.000Z",
};

const PUT_AWAY: SessionIndexEntry = {
  ...ORDERS,
  id: "ses_archived",
  title: "Old orders work",
  lifecycle: "archived",
};

const SESSIONS = [ORDERS, REVENUE, PUT_AWAY];

function labels(query: string): readonly string[] {
  return paletteItems(SESSIONS, query).map((item) => item.label);
}

describe("what the palette lists", () => {
  it("lists every action, then the active sessions newest first, for an empty query", () => {
    expect(labels("")).toEqual([
      "New session",
      "Show changes",
      "Show files",
      "Show Metabase",
      "Show or hide the side panel",
      "Metabase settings",
      "Repository settings",
      "Agents settings",
      "Appearance settings",
      "A revenue metric",
      "Clean the orders table",
    ]);
  });

  it("keeps an action whose label holds every word of the query, in any order", () => {
    expect(labels("settings agents")).toEqual(["Agents settings"]);
  });

  it("finds a session by its branch and never an archived one", () => {
    expect(labels("rde/orders")).toEqual(["Clean the orders table"]);
  });

  it("says where a session works and opens it by id", () => {
    const [found] = paletteItems(SESSIONS, "revenue");
    expect(found).toEqual({
      id: "session-ses_revenue",
      group: "Sessions",
      label: "A revenue metric",
      detail: "in the repository",
      binding: null,
      command: { kind: "open-session", sessionId: "ses_revenue" },
    });
  });

  it("lists nothing for a query nothing matches", () => {
    expect(labels("zebra")).toEqual([]);
  });
});

describe("moving the selection", () => {
  it("wraps past the last item to the first and before the first to the last", () => {
    expect(movedSelection(2, 1, 3)).toBe(0);
    expect(movedSelection(0, -1, 3)).toBe(2);
  });

  it("stays on the first slot of an empty list", () => {
    expect(movedSelection(0, 1, 0)).toBe(0);
  });
});
