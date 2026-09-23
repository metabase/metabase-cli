import { describe, expect, it } from "vitest";

import type { ContentItem, MetabaseWorktree, RemoteSyncState } from "../../contracts/metabase";
import type { ConnectedFeatures } from "../../contracts/settings";

import {
  IDLE_ACTIVITY,
  TRANSFORM_TESTS_OFF,
  age,
  branchView,
  contentRows,
  instanceHead,
  metadataLine,
  pollsMetabase,
  syncButton,
  syncRefusal,
  taskView,
  testsLine,
  type TransformActivity,
} from "./panel";

const NOW = new Date("2026-09-22T12:00:00.000Z");

describe("age", () => {
  it("counts in the largest whole unit that fits", () => {
    expect(age("2026-09-22T11:59:30.000Z", NOW)).toBe("just now");
    expect(age("2026-09-22T11:59:00.000Z", NOW)).toBe("1 minute ago");
    expect(age("2026-09-22T09:10:00.000Z", NOW)).toBe("2 hours ago");
    expect(age("2026-09-19T12:00:00.000Z", NOW)).toBe("3 days ago");
  });
});

describe("metadataLine", () => {
  it("dates the tree by its export, or says there is none", () => {
    expect(metadataLine({ kind: "present", extractedAt: "2026-09-22T10:00:00.000Z" }, NOW)).toBe(
      "Extracted 2 hours ago",
    );
    expect(metadataLine({ kind: "absent" }, NOW)).toBe("Not extracted yet.");
  });
});

const FEATURES: ConnectedFeatures = { remoteSync: true, transforms: true, transformTests: true };
const MAIN_METABASE: MetabaseWorktree = { kind: "absent" };
const UNLICENSED: ConnectedFeatures = {
  remoteSync: false,
  transforms: true,
  transformTests: false,
};

const READ: RemoteSyncState = {
  kind: "read",
  branch: "main",
  edits: [],
  remoteChanges: false,
  task: null,
  collectionCount: 0,
};

const TRANSFORM_ITEM: ContentItem = {
  path: "collections/transforms/orders_by_status.yaml",
  change: "added",
  entity: { kind: "transform", name: "e2e_orders_by_status" },
  validation: { kind: "valid" },
  url: "http://metabase.test/data-studio/transforms/1",
  transform: {
    id: 1,
    lastRun: { status: "succeeded", at: "2026-09-22T11:58:00.000Z", message: null },
  },
};

const SEGMENT_ITEM: ContentItem = {
  path: "databases/warehouse/schemas/public/tables/orders/segments/big_orders.yaml",
  change: "added",
  entity: { kind: "segment", name: "Big orders" },
  validation: {
    kind: "invalid",
    issues: [
      { pointer: "/", message: "must have required property 'definition'" },
      { pointer: "/table_id", message: "must be array" },
    ],
  },
  url: null,
  transform: null,
};

function idle(): TransformActivity {
  return IDLE_ACTIVITY;
}

describe("instanceHead", () => {
  it("names the host, the edition and version, and the user, and opens the session's worktree", () => {
    expect(
      instanceHead(
        "https://metabase.example.com/",
        { version: "v1.60.2", edition: "ee", features: FEATURES },
        "Ada",
        { kind: "ready", id: 7, branch: "feature" },
      ),
    ).toEqual({
      host: "metabase.example.com",
      url: "https://metabase.example.com/?worktree=7",
      version: "Enterprise v1.60.2",
      user: "Ada",
    });
  });

  it("names no version for a build that reports none", () => {
    const server = { version: null, edition: null, features: FEATURES };
    expect(
      instanceHead("http://localhost:3000", server, null, { kind: "absent" }).version,
    ).toBeNull();
  });
});

describe("branchView", () => {
  it("names the tracked branch, the edits made in Metabase and the remote's changes", () => {
    const view = branchView(
      {
        ...READ,
        edits: [
          { id: 1, name: "Orders Overview", model: "dashboard" },
          { id: 2, name: null, model: "card" },
          { id: 3, name: "Revenue", model: "card" },
          { id: 4, name: "Churn", model: "dashboard" },
        ],
        remoteChanges: true,
        collectionCount: 12,
      },
      NOW,
    );

    expect(view).toEqual({
      tracked: { lead: "Metabase is synced to", branch: "main", collections: "12 collections" },
      edits: {
        text: "4 edits made in Metabase aren't in git yet:",
        names: ["Orders Overview", "card 2", "Revenue"],
        more: 1,
      },
      remote: {
        text: "The remote branch has changes Metabase hasn't imported.",
        tone: "warning",
      },
      task: null,
    });
  });

  it("says nothing of edits or remote changes when Metabase agrees with git", () => {
    expect(branchView({ ...READ, branch: null }, NOW)).toEqual({
      tracked: { lead: "Metabase isn't synced to a branch yet.", branch: null, collections: null },
      edits: null,
      remote: null,
      task: null,
    });
  });

  it("shows nothing for an instance that was not read", () => {
    expect(branchView({ kind: "off" }, NOW)).toBeNull();
    expect(branchView({ kind: "unavailable", message: "402" }, NOW)).toBeNull();
  });
});

describe("taskView", () => {
  it("shows a running import's progress as a percentage", () => {
    expect(
      taskView(
        { kind: "import", status: "running", progress: 0.4, endedAt: null, message: null },
        NOW,
      ),
    ).toEqual({ kind: "running", label: "Importing", percent: 40 });
  });

  it("dates the last task's result and carries the server's message", () => {
    expect(
      taskView(
        {
          kind: "import",
          status: "conflict",
          progress: 1,
          endedAt: "2026-09-22T11:50:00.000Z",
          message: "orders.yaml changed",
        },
        NOW,
      ),
    ).toEqual({
      kind: "ended",
      status: "conflict",
      text: "Last import hit conflicts 10 minutes ago",
      detail: "orders.yaml changed",
      tone: "error",
    });
  });
});

describe("syncButton", () => {
  const ready = { kind: "ready" as const, branch: "rde/orders", push: true, guard: null };
  const running: RemoteSyncState = {
    ...READ,
    task: { kind: "import", status: "running", progress: 0.4, endedAt: null, message: null },
  };

  it("pushes first when the branch is not on the remote yet", () => {
    expect(syncButton(ready, false, READ)).toEqual({ label: "Push and sync", disabled: false });
  });

  it("waits while Metabase runs a task, whoever started it", () => {
    expect(syncButton(ready, false, running)).toEqual({ label: "Push and sync", disabled: true });
  });

  it("says it is syncing while this window syncs", () => {
    expect(syncButton(ready, true, READ)).toEqual({ label: "Syncing", disabled: true });
  });

  it("stays off while the branch is blocked", () => {
    const blocked = { kind: "blocked" as const, reason: "Commit first." };
    expect(syncButton(blocked, false, null)).toEqual({ label: "Sync to Metabase", disabled: true });
  });
});

describe("pollsMetabase", () => {
  it("reads Metabase again while this window syncs or while any task runs", () => {
    const running: RemoteSyncState = {
      ...READ,
      task: { kind: "import", status: "running", progress: null, endedAt: null, message: null },
    };
    expect(pollsMetabase(true, READ)).toBe(true);
    expect(pollsMetabase(false, running)).toBe(true);
    expect(pollsMetabase(false, READ)).toBe(false);
    expect(pollsMetabase(false, null)).toBe(false);
  });
});

function busy(): TransformActivity {
  return {
    run: { kind: "running" },
    tests: { kind: "running" },
  };
}

function answered(): TransformActivity {
  return {
    run: {
      kind: "answered",
      outcome: {
        kind: "ran",
        run: { status: "failed", at: "2026-09-22T11:59:30.000Z", message: "relation missing" },
      },
    },
    tests: {
      kind: "answered",
      outcome: {
        kind: "ran",
        tests: [{ name: "No test rows", status: "failed", failing: ["drops test rows"] }],
      },
    },
  };
}

describe("contentRows", () => {
  it("names each file's object by kind and name, and an invalid one by its errors", () => {
    expect(
      contentRows([SEGMENT_ITEM], { features: FEATURES, worktree: MAIN_METABASE }, idle, NOW),
    ).toEqual([
      {
        path: SEGMENT_ITEM.path,
        fileName: "big_orders.yaml",
        kind: "Segment",
        name: "Big orders",
        change: "new",
        validation: {
          kind: "invalid",
          lines: ["must have required property 'definition'", "/table_id: must be array"],
        },
        url: null,
        transform: null,
      },
    ]);
  });

  it("names a deleted file that holds no object by its file name", () => {
    const deleted: ContentItem = {
      ...SEGMENT_ITEM,
      entity: null,
      validation: null,
      change: "deleted",
    };
    expect(
      contentRows([deleted], { features: FEATURES, worktree: MAIN_METABASE }, idle, NOW),
    ).toEqual([
      {
        path: SEGMENT_ITEM.path,
        fileName: "big_orders.yaml",
        kind: "File",
        name: "big_orders.yaml",
        change: "deleted",
        validation: null,
        url: null,
        transform: null,
      },
    ]);
  });

  it("offers a held transform's run and tests, with its last run", () => {
    expect(
      contentRows([TRANSFORM_ITEM], { features: FEATURES, worktree: MAIN_METABASE }, idle, NOW)[0]
        ?.transform,
    ).toEqual({
      id: 1,
      run: { kind: "enabled" },
      tests: { kind: "enabled" },
      lastRun: { status: "succeeded", text: "Last run succeeded 2 minutes ago.", tone: "ok" },
      runRefusal: null,
      testsLine: null,
    });
  });

  it("gives a missing feature as the reason an action is off", () => {
    const transform = contentRows(
      [TRANSFORM_ITEM],
      { features: UNLICENSED, worktree: MAIN_METABASE },
      idle,
      NOW,
    )[0]?.transform;
    expect([transform?.run, transform?.tests]).toEqual([
      { kind: "enabled" },
      { kind: "disabled", reason: TRANSFORM_TESTS_OFF },
    ]);
  });

  it("asks for a sign-in before anything runs without a server", () => {
    expect(
      contentRows([TRANSFORM_ITEM], { features: null, worktree: MAIN_METABASE }, idle, NOW)[0]
        ?.transform?.run,
    ).toEqual({
      kind: "disabled",
      reason: "Sign in to Metabase again to run it.",
    });
  });

  it("shows a run and a test run in flight", () => {
    const transform = contentRows(
      [TRANSFORM_ITEM],
      { features: FEATURES, worktree: MAIN_METABASE },
      busy,
      NOW,
    )[0]?.transform;
    expect([transform?.run, transform?.tests]).toEqual([{ kind: "running" }, { kind: "running" }]);
  });

  it("shows the run this window answered and its tests' result", () => {
    const transform = contentRows(
      [TRANSFORM_ITEM],
      { features: FEATURES, worktree: MAIN_METABASE },
      answered,
      NOW,
    )[0]?.transform;
    expect([transform?.lastRun, transform?.testsLine]).toEqual([
      { status: "failed", text: "Last run failed just now. relation missing", tone: "error" },
      { text: "1 of 1 test failed: No test rows (drops test rows).", tone: "error" },
    ]);
  });
});

describe("testsLine", () => {
  it("counts passing tests", () => {
    const passed = [
      { name: "a", status: "passed" as const, failing: [] },
      { name: "b", status: "passed" as const, failing: [] },
    ];
    expect(testsLine({ kind: "ran", tests: passed })).toEqual({
      text: "2 tests passed.",
      tone: "ok",
    });
  });

  it("says when a transform has no tests", () => {
    expect(testsLine({ kind: "ran", tests: [] })).toEqual({
      text: "This transform has no tests yet.",
      tone: "quiet",
    });
  });
});

describe("syncRefusal", () => {
  const failedSync = {
    kind: "sync" as const,
    id: "evt_1",
    at: "2026-09-22T11:00:00.000Z",
    branch: "rde/big-orders",
    outcome: { kind: "failed" as const, message: "remote_sync is not enabled" },
  };

  it("repeats nothing the last recorded sync already says", () => {
    expect(
      syncRefusal({ kind: "refused", message: "remote_sync is not enabled" }, failedSync),
    ).toBeNull();
  });

  it("shows a refusal that recorded no sync", () => {
    expect(
      syncRefusal({ kind: "refused", message: "This session is already syncing." }, failedSync),
    ).toBe("This session is already syncing.");
  });

  it("shows nothing for a finished sync or before the first one", () => {
    expect(syncRefusal({ kind: "done" }, null)).toBeNull();
    expect(syncRefusal(null, null)).toBeNull();
  });
});
