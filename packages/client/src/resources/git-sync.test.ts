import { assert, describe, expect, it } from "vitest";

import { createClient } from "../client";
import { HttpError } from "../http/errors";
import type { ClientCredentials } from "../http/transport";
import { captureFetch, jsonResponse, TEST_USER_AGENT } from "../testing/fetch-capture";

const CREDENTIALS: ClientCredentials = {
  url: "https://mb.example.com/metabase",
  credential: { kind: "apiKey", apiKey: "mb_wire_test_key" },
};

const RUNNING_TASK = {
  id: 12,
  sync_task_type: "import",
  status: "running",
  progress: 0.5,
  started_at: "2026-05-21T00:00:00Z",
};

const SETTLED_TASK = { ...RUNNING_TASK, status: "successful", progress: 1 };

const DIRTY_ITEM = {
  id: 4,
  name: "Orders",
  model: "card",
  sync_status: "modified",
  collection_id: 9,
};

// Values the server sends and the collection domain schema does not enumerate.
const UNPINNED_ENUM_FIELDS = {
  type: "workspace",
  namespace: "workspaces",
  authority_level: "critical",
};

const JSON_READ_HEADERS = {
  accept: "application/json",
  "user-agent": TEST_USER_AGENT,
  "x-api-key": "mb_wire_test_key",
};

const JSON_WRITE_HEADERS = {
  accept: "application/json",
  "content-type": "application/json",
  "user-agent": TEST_USER_AGENT,
  "x-api-key": "mb_wire_test_key",
};

const BINARY_READ_HEADERS = {
  accept: "*/*",
  "user-agent": TEST_USER_AGENT,
  "x-api-key": "mb_wire_test_key",
};

const IMMEDIATE_POLL = { intervalMs: 1, timeoutMs: 1_000 };

function clientOver(responses: Array<Response>) {
  const capture = captureFetch(responses);
  const mb = createClient(CREDENTIALS, {
    userAgent: TEST_USER_AGENT,
    fetchImpl: capture.fetch,
  });
  return { mb, capture };
}

function noContent(): Response {
  return new Response(null, { status: 204 });
}

async function thrownBy(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error: unknown) {
    return error;
  }
  throw new Error("expected the call to reject");
}

describe("git-sync resource wire requests", () => {
  it("sends the current-task request as an optional GET", async () => {
    const { mb, capture } = clientOver([jsonResponse(RUNNING_TASK)]);

    await mb.gitSync.currentTask();

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/ee/remote-sync/current-task",
        method: "GET",
        headers: BINARY_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("reads the current-task 204 as no task at all", async () => {
    const { mb } = clientOver([noContent()]);

    expect(await mb.gitSync.currentTask()).toBeNull();
  });

  it("sends the cancel request as a POST without a body", async () => {
    const { mb, capture } = clientOver([jsonResponse({ ...RUNNING_TASK, cancelled: true })]);

    await mb.gitSync.cancelTask();

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/ee/remote-sync/current-task/cancel",
        method: "POST",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("sends the is-dirty request", async () => {
    const { mb, capture } = clientOver([jsonResponse({ is_dirty: true })]);

    await mb.gitSync.isDirty();

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/ee/remote-sync/is-dirty",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("unwraps the is-dirty envelope to the flag itself", async () => {
    const { mb } = clientOver([jsonResponse({ is_dirty: true })]);

    expect(await mb.gitSync.isDirty()).toBe(true);
  });

  it("sends the dirty listing request", async () => {
    const { mb, capture } = clientOver([jsonResponse({ dirty: [DIRTY_ITEM] })]);

    await mb.gitSync.dirty();

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/ee/remote-sync/dirty",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("reports no total for the dirty listing, which the server does not count", async () => {
    const { mb } = clientOver([jsonResponse({ dirty: [DIRTY_ITEM] })]);

    expect(await mb.gitSync.dirty()).toEqual({ data: [DIRTY_ITEM], total: null });
  });

  it("sends the force-refresh flag as a has-remote-changes query parameter", async () => {
    const { mb, capture } = clientOver([
      jsonResponse({
        has_changes: false,
        remote_version: null,
        local_version: null,
        cached: true,
      }),
    ]);

    await mb.gitSync.hasRemoteChanges({ "force-refresh": true });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/ee/remote-sync/has-remote-changes?force-refresh=true",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("omits the has-remote-changes query when no force-refresh is asked for", async () => {
    const { mb, capture } = clientOver([
      jsonResponse({
        has_changes: true,
        remote_version: "abc123",
        local_version: "def456",
        cached: false,
      }),
    ]);

    await mb.gitSync.hasRemoteChanges();

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/ee/remote-sync/has-remote-changes",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("sends the import request with the branch and force fields it was given", async () => {
    const { mb, capture } = clientOver([
      jsonResponse({ status: "success", task_id: 12, message: "Import queued" }),
    ]);

    await mb.gitSync.import({ branch: "main", force: true });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/ee/remote-sync/import",
        method: "POST",
        headers: JSON_WRITE_HEADERS,
        body: '{"branch":"main","force":true}',
      },
    ]);
  });

  it("returns the started import without a final task when no wait is given", async () => {
    const { mb } = clientOver([
      jsonResponse({ status: "success", task_id: 12, message: "Import queued" }),
    ]);

    expect(await mb.gitSync.import()).toEqual({ message: "Import queued", task_id: 12 });
  });

  it("polls the current task after the import POST when a wait schedule is given", async () => {
    const { mb, capture } = clientOver([
      jsonResponse({ status: "success", task_id: 12, message: "Import queued" }),
      jsonResponse(RUNNING_TASK),
      jsonResponse(SETTLED_TASK),
    ]);

    await mb.gitSync.import({ wait: IMMEDIATE_POLL });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/ee/remote-sync/import",
        method: "POST",
        headers: JSON_WRITE_HEADERS,
        body: "{}",
      },
      {
        url: "https://mb.example.com/metabase/api/ee/remote-sync/current-task",
        method: "GET",
        headers: BINARY_READ_HEADERS,
        body: null,
      },
      {
        url: "https://mb.example.com/metabase/api/ee/remote-sync/current-task",
        method: "GET",
        headers: BINARY_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("reports the settled task alongside the import that started it", async () => {
    const { mb } = clientOver([
      jsonResponse({ status: "success", task_id: 12, message: "Import queued" }),
      jsonResponse(SETTLED_TASK),
    ]);

    expect(await mb.gitSync.import({ wait: IMMEDIATE_POLL })).toEqual({
      message: "Import queued",
      task_id: 12,
      final: SETTLED_TASK,
    });
  });

  it("does not poll for an import the server answered with no task to wait on", async () => {
    const { mb, capture } = clientOver([
      jsonResponse({ status: "success", task_id: null, message: "Already up to date" }),
    ]);

    await mb.gitSync.import({ wait: IMMEDIATE_POLL });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/ee/remote-sync/import",
        method: "POST",
        headers: JSON_WRITE_HEADERS,
        body: "{}",
      },
    ]);
  });

  it("sends the export request with the branch, message and force fields it was given", async () => {
    const { mb, capture } = clientOver([jsonResponse({ message: "Export queued", task_id: 8 })]);

    await mb.gitSync.export({ branch: "main", message: "update dashboards", force: true });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/ee/remote-sync/export",
        method: "POST",
        headers: JSON_WRITE_HEADERS,
        body: '{"branch":"main","message":"update dashboards","force":true}',
      },
    ]);
  });

  it("reports the settled task alongside the export that started it", async () => {
    const { mb } = clientOver([
      jsonResponse({ message: "Export queued", task_id: 8 }),
      jsonResponse(SETTLED_TASK),
    ]);

    expect(await mb.gitSync.export({ wait: IMMEDIATE_POLL })).toEqual({
      message: "Export queued",
      task_id: 8,
      final: SETTLED_TASK,
    });
  });

  it("sends the stash request with the new branch and commit message", async () => {
    const { mb, capture } = clientOver([
      jsonResponse({ status: "success", message: "Stash queued", task_id: 5 }),
    ]);

    await mb.gitSync.stash({ new_branch: "wip", message: "work in progress" });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/ee/remote-sync/stash",
        method: "POST",
        headers: JSON_WRITE_HEADERS,
        body: '{"new_branch":"wip","message":"work in progress"}',
      },
    ]);
  });

  it("reports the settled task alongside the stash that started it", async () => {
    const { mb } = clientOver([
      jsonResponse({ status: "success", message: "Stash queued", task_id: 5 }),
      jsonResponse(SETTLED_TASK),
    ]);

    expect(
      await mb.gitSync.stash({ new_branch: "wip", message: "x", wait: IMMEDIATE_POLL }),
    ).toEqual({ status: "success", message: "Stash queued", task_id: 5, final: SETTLED_TASK });
  });

  it("sends the branches request", async () => {
    const { mb, capture } = clientOver([jsonResponse({ items: ["main", "wip"] })]);

    await mb.gitSync.branches();

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/ee/remote-sync/branches",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("unwraps the branches envelope into an uncounted listing", async () => {
    const { mb } = clientOver([jsonResponse({ items: ["main", "wip"] })]);

    expect(await mb.gitSync.branches()).toEqual({ data: ["main", "wip"], total: null });
  });

  it("sends the create-branch request with the name in the body", async () => {
    const { mb, capture } = clientOver([
      jsonResponse({ status: "success", message: "Created feat/x" }),
    ]);

    await mb.gitSync.createBranch({ name: "feat/x" });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/ee/remote-sync/create-branch",
        method: "POST",
        headers: JSON_WRITE_HEADERS,
        body: '{"name":"feat/x"}',
      },
    ]);
  });

  it("sends the collection sync flag as a settings PUT keyed by collection id", async () => {
    const { mb, capture } = clientOver([jsonResponse({ success: true, task_id: 3 })]);

    await mb.gitSync.setCollectionSynced(12, true);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/ee/remote-sync/settings",
        method: "PUT",
        headers: JSON_WRITE_HEADERS,
        body: '{"collections":{"12":true}}',
      },
    ]);
  });

  it("sends a false flag to unmark a collection", async () => {
    const { mb, capture } = clientOver([jsonResponse({ success: true })]);

    await mb.gitSync.setCollectionSynced(12, false);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/ee/remote-sync/settings",
        method: "PUT",
        headers: JSON_WRITE_HEADERS,
        body: '{"collections":{"12":false}}',
      },
    ]);
  });

  it("reads the synced collections off the library-inclusive collection listing", async () => {
    const { mb, capture } = clientOver([jsonResponse([])]);

    await mb.gitSync.syncedCollections();

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/collection?include-library=true",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("keeps only the collections the server flagged for sync", async () => {
    const synced = { id: 4, name: "Ops", is_remote_synced: true };
    const { mb } = clientOver([
      jsonResponse([
        { id: 51, name: "Data", is_remote_synced: false },
        synced,
        { id: "root", name: "Our analytics", is_remote_synced: false },
        { id: 9, name: "Legacy", is_remote_synced: null },
      ]),
    ]);

    expect(await mb.gitSync.syncedCollections()).toEqual({ data: [synced], total: null });
  });

  it("reads the sync scope past collections whose enum fields carry unpinned values", async () => {
    const { mb } = clientOver([
      jsonResponse([
        { ...UNPINNED_ENUM_FIELDS, id: 51, name: "Workspace", is_remote_synced: false },
        { ...UNPINNED_ENUM_FIELDS, id: 4, name: "Ops", is_remote_synced: true },
      ]),
    ]);

    expect(await mb.gitSync.syncedCollections()).toEqual({
      data: [{ id: 4, name: "Ops", is_remote_synced: true }],
      total: null,
    });
  });

  it("reads the remote url off its own setting", async () => {
    const { mb, capture } = clientOver([jsonResponse("https://github.com/acme/sync.git")]);

    await mb.gitSync.remoteUrl();

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/setting/remote-sync-url",
        method: "GET",
        headers: BINARY_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("reads an unconfigured remote url setting's null as no remote", async () => {
    const { mb } = clientOver([jsonResponse(null)]);

    expect(await mb.gitSync.remoteUrl()).toBeNull();
  });

  it("normalizes an empty remote url setting to no remote", async () => {
    const { mb } = clientOver([jsonResponse("")]);

    expect(await mb.gitSync.remoteUrl()).toBeNull();
  });

  it("reports no remote when the caller may not read settings", async () => {
    const { mb } = clientOver([jsonResponse({ message: "You don't have permissions" }, 403)]);

    expect(await mb.gitSync.remoteUrl()).toBeNull();
  });

  it("reports no remote when the setting is not registered on the server", async () => {
    const { mb } = clientOver([jsonResponse({ message: "Not found." }, 404)]);

    expect(await mb.gitSync.remoteUrl()).toBeNull();
  });

  it("rethrows a remote url failure that is neither a permission nor a registration answer", async () => {
    const { mb } = clientOver([jsonResponse({ message: "boom" }, 500)]);

    const error = await thrownBy(() => mb.gitSync.remoteUrl({ retries: 0 }));

    expect(error).toBeInstanceOf(HttpError);
    assert(error instanceof HttpError, "expected HttpError");
    expect(error.message).toBe("boom");
  });

  it("reads the tracked branch off its own setting", async () => {
    const { mb, capture } = clientOver([jsonResponse("main")]);

    await mb.gitSync.branch();

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/setting/remote-sync-branch",
        method: "GET",
        headers: BINARY_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("reads an unset branch setting's 204 as no branch", async () => {
    const { mb } = clientOver([noContent()]);

    expect(await mb.gitSync.branch()).toBeNull();
  });

  it("reads an unconfigured branch setting's null as no branch", async () => {
    const { mb } = clientOver([jsonResponse(null)]);

    expect(await mb.gitSync.branch()).toBeNull();
  });

  it("answers the task in the status that ended the wait", async () => {
    const { mb } = clientOver([jsonResponse(RUNNING_TASK), jsonResponse(SETTLED_TASK)]);

    expect(await mb.gitSync.waitForTask(IMMEDIATE_POLL)).toEqual(SETTLED_TASK);
  });

  it("re-reads the current task until it leaves the running status", async () => {
    const { mb, capture } = clientOver([jsonResponse(RUNNING_TASK), jsonResponse(SETTLED_TASK)]);

    await mb.gitSync.waitForTask(IMMEDIATE_POLL);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/ee/remote-sync/current-task",
        method: "GET",
        headers: BINARY_READ_HEADERS,
        body: null,
      },
      {
        url: "https://mb.example.com/metabase/api/ee/remote-sync/current-task",
        method: "GET",
        headers: BINARY_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("stops waiting at once when the server reports no task", async () => {
    const { mb } = clientOver([noContent()]);

    expect(await mb.gitSync.waitForTask(IMMEDIATE_POLL)).toBeNull();
  });
});
