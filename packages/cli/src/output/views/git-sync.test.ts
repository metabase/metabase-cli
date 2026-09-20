import { describe, expect, it } from "vitest";

import type { SyncExportPreflight } from "@metabase/client/domain/git-sync";

import { formatExportPreflight } from "./git-sync";

const NO_CHANGES: SyncExportPreflight = {
  has_changes: false,
  clean: true,
  conflicts: [],
  summary: { added: 0, updated: 0, removed: 0 },
  force_push_casualties: { deleted: [], overwritten: [] },
  reason: null,
};

describe("formatExportPreflight", () => {
  it("says an export applies as-is when the remote is at the last synced version", () => {
    expect(formatExportPreflight("main", NO_CHANGES)).toBe(
      "Branch main: the remote has not moved past the last sync, or nothing has been synced yet; an export applies as-is.",
    );
  });

  it("counts what a clean merge folds in and what a force push would discard instead", () => {
    const clean: SyncExportPreflight = {
      ...NO_CHANGES,
      has_changes: true,
      summary: { added: 3, updated: 1, removed: 0 },
      force_push_casualties: { deleted: ["Card: Revenue"], overwritten: [] },
    };

    expect(formatExportPreflight("feat/x", clean)).toBe(
      [
        "Branch feat/x: the remote has moved on; a merge applies cleanly.",
        "A merge would fold in 3 added, 1 updated, 0 removed.",
        "A force push would delete (1):",
        "  Card: Revenue",
      ].join("\n"),
    );
  });

  it("lists the conflicting entities before the merge summary", () => {
    const conflicting: SyncExportPreflight = {
      ...NO_CHANGES,
      has_changes: true,
      clean: false,
      conflicts: ["Dashboard: Orders", "Card: Revenue"],
      summary: { added: 0, updated: 2, removed: 1 },
      force_push_casualties: { deleted: [], overwritten: ["Dashboard: Orders", "Card: Revenue"] },
    };

    expect(formatExportPreflight("main", conflicting)).toBe(
      [
        "Branch main: the remote has moved on; a merge would conflict.",
        "Conflicts (2):",
        "  Dashboard: Orders",
        "  Card: Revenue",
        "A merge would fold in 0 added, 2 updated, 1 removed.",
        "A force push would overwrite (2):",
        "  Dashboard: Orders",
        "  Card: Revenue",
      ].join("\n"),
    );
  });

  it("offers only a force push when the remote history was rewritten", () => {
    const rewritten: SyncExportPreflight = {
      ...NO_CHANGES,
      has_changes: true,
      clean: false,
      reason: "history-rewritten",
      force_push_casualties: { deleted: ["Collection: Archive"], overwritten: ["Card: Revenue"] },
    };

    expect(formatExportPreflight("main", rewritten)).toBe(
      [
        "Branch main: the remote history was rewritten, so no merge base exists; only a force push can export.",
        "A force push would delete (1):",
        "  Collection: Archive",
        "A force push would overwrite (1):",
        "  Card: Revenue",
      ].join("\n"),
    );
  });
});
