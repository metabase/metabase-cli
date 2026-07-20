import { expect, test } from "vitest";
import type { InstanceContext } from "../metabase/probe";
import { type Responder, toolDeps } from "./fake-client";
import { runGitSyncTool } from "./git-sync";
import { TeachingError } from "./teaching-error";

const EE_60: InstanceContext = {
  url: "https://mb.example.com",
  versionTag: "v1.60.0",
  majorVersion: 60,
  edition: "enterprise",
  tokenFeatures: ["remote_sync"],
  user: null,
};

const OSS_60: InstanceContext = { ...EE_60, versionTag: "v0.60.0", tokenFeatures: [] };

const DIRTY_CARD = {
  id: 21,
  name: "Revenue",
  model: "card",
  sync_status: "modified",
  collection_id: 5,
};

const COLLECTIONS = [
  { id: 5, name: "Finance", is_remote_synced: true },
  { id: 6, name: "Scratch", is_remote_synced: false },
];

function conflictTask(): unknown {
  return {
    id: 3,
    sync_task_type: "export",
    status: "conflict",
    progress: 1,
    started_at: "2026-07-01T00:00:00Z",
    error_message: "Remote has diverged.",
    conflicts: ["collections/finance/revenue.yaml"],
  };
}

const STATUS: Responder = (path) => {
  switch (path) {
    case "/api/setting/remote-sync-branch": {
      return "main";
    }
    case "/api/ee/remote-sync/is-dirty": {
      return { is_dirty: true };
    }
    case "/api/ee/remote-sync/dirty": {
      return { dirty: [DIRTY_CARD] };
    }
    case "/api/ee/remote-sync/has-remote-changes": {
      return {
        has_changes: false,
        remote_version: "abc123",
        local_version: "abc123",
        cached: false,
      };
    }
    case "/api/ee/remote-sync/current-task": {
      return new Response(null, { status: 204 });
    }
    case "/api/collection": {
      return COLLECTIONS;
    }
    default: {
      throw new Error(`unexpected path ${path}`);
    }
  }
};

test("status answers branch, local changes, remote changes and scope in one call", async () => {
  const { deps, requests } = toolDeps(STATUS, "/tmp", EE_60);

  const result = await runGitSyncTool(deps, { action: "status" });

  expect(requests.map((request) => request.path).toSorted()).toEqual([
    "/api/collection",
    "/api/ee/remote-sync/current-task",
    "/api/ee/remote-sync/dirty",
    "/api/ee/remote-sync/has-remote-changes",
    "/api/ee/remote-sync/is-dirty",
    "/api/setting/remote-sync-branch",
  ]);
  expect(result.details).toEqual({
    kind: "json",
    label: "git-sync on branch main — 1 local changes not yet exported, the remote is not ahead",
    value: {
      branch: "main",
      is_dirty: true,
      dirty_items: [DIRTY_CARD],
      remote_has_changes: false,
      remote_version: "abc123",
      local_version: "abc123",
      current_task: null,
      synced_collections: [{ id: 5, name: "Finance" }],
    },
  });
});

const SUCCESSFUL_EXPORT: Responder = (path, options) => {
  if (path === "/api/ee/remote-sync/export" && options?.method === "POST") {
    return { message: "Export started", task_id: 3 };
  }
  return {
    id: 3,
    sync_task_type: "export",
    status: "successful",
    progress: 1,
    started_at: "2026-07-01T00:00:00Z",
    version: "def456",
  };
};

const CONFLICTED_EXPORT: Responder = (path, options) => {
  if (path === "/api/ee/remote-sync/export" && options?.method === "POST") {
    return { message: "Export started", task_id: 3 };
  }
  return conflictTask();
};

const UP_TO_DATE_IMPORT: Responder = (path, options) => {
  if (path === "/api/ee/remote-sync/import" && options?.method === "POST") {
    return { task_id: null, message: "Already up to date." };
  }
  throw new Error(`unexpected path ${path}`);
};

test("export waits for the task and reports the terminal status", async () => {
  const { deps, requests } = toolDeps(SUCCESSFUL_EXPORT, "/tmp", EE_60);

  const result = await runGitSyncTool(deps, { action: "export", message: "Add dashboards" });

  expect(requests).toEqual([
    {
      path: "/api/ee/remote-sync/export",
      method: "POST",
      options: { method: "POST", body: { message: "Add dashboards" } },
    },
    {
      path: "/api/ee/remote-sync/current-task",
      method: "GET",
      options: { method: "GET", expectContentType: "binary" },
    },
  ]);
  expect(result.details).toEqual({
    kind: "json",
    label: "export task 3 succeeded",
    value: {
      id: 3,
      sync_task_type: "export",
      status: "successful",
      progress: 1,
      version: "def456",
      error_message: undefined,
    },
  });
});

test("a conflicted task names the conflicting files and refuses to reach for force itself", async () => {
  const { deps } = toolDeps(CONFLICTED_EXPORT, "/tmp", EE_60);

  await expect(runGitSyncTool(deps, { action: "export" })).rejects.toThrow(
    new TeachingError(
      "The export task 3 hit conflicts — the same content changed on both sides. Conflicting: collections/finance/revenue.yaml. Resolving one means discarding the other side's version, so ask the user which side wins before using `force`.",
    ),
  );
});

test("force travels to the server only when the caller sets it", async () => {
  const { deps, requests } = toolDeps(UP_TO_DATE_IMPORT, "/tmp", EE_60);

  const result = await runGitSyncTool(deps, { action: "import", branch: "main", force: true });

  expect(requests).toEqual([
    {
      path: "/api/ee/remote-sync/import",
      method: "POST",
      options: { method: "POST", body: { branch: "main", force: true } },
    },
  ]);
  expect(result.details).toEqual({
    kind: "json",
    label: "Already up to date.",
    value: { imported: false, message: "Already up to date." },
  });
});

test("an instance without the remote_sync feature refuses before any request leaves", async () => {
  const { deps, requests } = toolDeps(STATUS, "/tmp", OSS_60);

  await expect(runGitSyncTool(deps, { action: "status" })).rejects.toThrow(
    new TeachingError(
      "`git_sync` needs the `remote_sync` paid feature, which this instance does not have enabled. There is no workaround from this session.",
    ),
  );
  expect(requests).toEqual([]);
});
