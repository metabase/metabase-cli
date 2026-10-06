import { assert, describe, expect, it } from "vitest";

import { createClient } from "../client";
import { ConfigError } from "../errors";
import { HttpError } from "../http/errors";
import type { ClientCredentials } from "../http/transport";
import {
  captureFetch,
  jsonResponse,
  premiumRefusalResponse,
  probeResponse,
  routeMissingResponse,
  TEST_USER_AGENT,
  thrownBy,
} from "../testing/fetch-capture";
import { CapabilityError } from "../version/capability-error";
import { PROBE_PATH } from "../version/probe";
import { createServerProfile, type ServerProfile } from "../version/profile";

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

const CLEAN_PREFLIGHT = {
  has_changes: false,
  clean: true,
  conflicts: [],
  summary: { added: 0, updated: 0, removed: 0 },
  force_push_casualties: { deleted: [], overwritten: [] },
  reason: null,
};

const IMMEDIATE_POLL = { intervalMs: 1, timeoutMs: 1_000 };

// The least server that answers this resource, so a method asking for more than the resource's
// own feature is refused here before it reaches the scripted wire.
const SERVER = createServerProfile({
  edition: "ee",
  version: { kind: "release", tag: "v1.60.0", major: 60, patch: 0 },
  date: null,
  hash: null,
  tokenFeatures: { remote_sync: true },
});

const SERVER_WITH_PREFLIGHT = createServerProfile({
  edition: "ee",
  version: { kind: "release", tag: "v1.63.0", major: 63, patch: 0 },
  date: null,
  hash: null,
  tokenFeatures: { remote_sync: true },
});

const UNLICENSED_SERVER = createServerProfile({
  edition: "ee",
  version: { kind: "release", tag: "v1.63.0", major: 63, patch: 0 },
  date: null,
  hash: null,
  tokenFeatures: { remote_sync: false },
});

function clientOver(responses: Array<Response>, server: ServerProfile = SERVER) {
  const capture = captureFetch(responses);
  const mb = createClient(CREDENTIALS, {
    userAgent: TEST_USER_AGENT,
    fetchImpl: capture.fetch,
    server,
  });
  return { mb, capture };
}

const PROBE_URL = `https://mb.example.com/metabase${PROBE_PATH}`;

const PROPERTIES_READ = { url: PROBE_URL, method: "GET", headers: JSON_READ_HEADERS, body: null };

// The session properties `profile`'s server answers, carrying the settings in `settings`.
function sessionProperties(settings: object, profile: ServerProfile = SERVER): Response {
  return jsonResponse({ version: { tag: profile.version.tag }, ...settings });
}

// The session properties an admin reads on a server tracking `branch`, by default one that guards
// it and so is sent it.
function trackedBranchResponse(
  branch: string,
  profile: ServerProfile = SERVER_WITH_PREFLIGHT,
): Response {
  return sessionProperties(
    {
      "remote-sync-branch": branch,
      "token-features": { remote_sync: true },
    },
    profile,
  );
}

function noContent(): Response {
  return new Response(null, { status: 204 });
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

  it("sends the import request with the branch and force fields it was given, expecting the tracked branch", async () => {
    const { mb, capture } = clientOver([
      trackedBranchResponse("main"),
      jsonResponse({ status: "success", task_id: 12, message: "Import queued" }),
    ]);

    await mb.gitSync.import({ branch: "release", force: true });

    expect(capture.calls).toEqual([
      PROPERTIES_READ,
      {
        url: "https://mb.example.com/metabase/api/ee/remote-sync/import",
        method: "POST",
        headers: JSON_WRITE_HEADERS,
        body: '{"branch":"release","force":true,"expected_branch":"main"}',
      },
    ]);
  });

  it("sends the expected branch it was given without reading the setting", async () => {
    const { mb, capture } = clientOver([
      jsonResponse({ status: "success", task_id: 12, message: "Import queued" }),
    ]);

    await mb.gitSync.import({ expected_branch: "dev" });

    expect(capture.calls.map((call) => call.body)).toEqual(['{"expected_branch":"dev"}']);
  });

  it("sends no tracked branch to a server before the branch guard, which reads its own", async () => {
    const { mb, capture } = clientOver([
      trackedBranchResponse("main", SERVER),
      jsonResponse({ status: "success", task_id: 12, message: "Import queued" }),
    ]);

    await mb.gitSync.import();

    expect(capture.calls.map((call) => call.body)).toEqual([null, "{}"]);
  });

  it("sends no expected branch where the setting is hidden on a server without remote sync, and explains its refusal", async () => {
    const { mb, capture } = clientOver([
      sessionProperties({ "token-features": { remote_sync: false } }, UNLICENSED_SERVER),
      premiumRefusalResponse("Remote Sync"),
    ]);

    const error = await thrownBy(() => mb.gitSync.import());

    assert(error instanceof CapabilityError, "expected CapabilityError");
    expect(error.developerDetail).toEqual({
      reason: "missing-token-feature",
      detail:
        "This operation requires the 'remote_sync' premium feature (not enabled on this server).",
      feature: "remoteSync",
      since: 58,
      tokenFeature: "remote_sync",
      serverVersion: "v1.63.0",
    });
    expect(capture.calls.map((call) => [call.url, call.body])).toEqual([
      [PROBE_URL, null],
      ["https://mb.example.com/metabase/api/ee/remote-sync/import", "{}"],
    ]);
  });

  it("sends no expected branch to a licensed-out server whose setting is unset, and explains its refusal", async () => {
    const { mb, capture } = clientOver([
      sessionProperties(
        { "remote-sync-branch": null, "token-features": { remote_sync: false } },
        UNLICENSED_SERVER,
      ),
      premiumRefusalResponse("Remote Sync"),
    ]);

    const error = await thrownBy(() => mb.gitSync.export());

    assert(error instanceof CapabilityError, "expected CapabilityError");
    expect(error.developerDetail.feature).toBe("remoteSync");
    expect(capture.calls.map((call) => [call.url, call.body])).toEqual([
      [PROBE_URL, null],
      ["https://mb.example.com/metabase/api/ee/remote-sync/export", "{}"],
    ]);
  });

  it("refuses an import for a caller who cannot read the setting on a server guarding the branch", async () => {
    const { mb, capture } = clientOver([
      sessionProperties({ "token-features": { remote_sync: true } }, SERVER_WITH_PREFLIGHT),
    ]);

    const error = await thrownBy(() => mb.gitSync.import());

    assert(error instanceof ConfigError, "expected ConfigError");
    expect(error.message).toBe(
      "the remote-sync-branch setting is not readable: it is visible to admins only",
    );
    expect(capture.calls).toEqual([PROPERTIES_READ]);
  });

  it("refuses an import when a server guarding the branch tracks none", async () => {
    const { mb, capture } = clientOver([
      sessionProperties(
        { "remote-sync-branch": null, "token-features": { remote_sync: true } },
        SERVER_WITH_PREFLIGHT,
      ),
    ]);

    const error = await thrownBy(() => mb.gitSync.import());

    assert(error instanceof ConfigError, "expected ConfigError");
    expect(error.message).toBe(
      "git-sync tracks no branch: the remote-sync-branch setting is unset",
    );
    expect(capture.calls).toEqual([PROPERTIES_READ]);
  });

  it("refuses a merge before the wire on a server a fresh probe finds without three-way merge", async () => {
    const { mb, capture } = clientOver([probeResponse(SERVER)], SERVER_WITH_PREFLIGHT);

    const error = await thrownBy(() => mb.gitSync.import({ merge: true }));

    assert(error instanceof CapabilityError, "expected CapabilityError");
    expect(error.developerDetail).toEqual({
      reason: "version-too-old",
      detail:
        "This operation requires Metabase v63+ (this server is v1.60.0). Upgrade Metabase to use it.",
      feature: "remoteSyncMerge",
      since: 63,
      tokenFeature: "remote_sync",
      serverVersion: "v1.60.0",
    });
    expect(capture.calls).toEqual([PROPERTIES_READ]);
  });

  it("judges a merge by the branch read, sending nothing more before the import", async () => {
    const { mb, capture } = clientOver([
      sessionProperties(
        { "remote-sync-branch": "main", "token-features": { remote_sync: true } },
        SERVER_WITH_PREFLIGHT,
      ),
      jsonResponse({ status: "success", task_id: 12, message: "Import queued" }),
    ]);

    await mb.gitSync.import({ merge: true });

    expect(capture.calls.map((call) => [call.url, call.body])).toEqual([
      [PROBE_URL, null],
      [
        "https://mb.example.com/metabase/api/ee/remote-sync/import",
        '{"merge":true,"expected_branch":"main"}',
      ],
    ]);
  });

  it("explains a refused import from its own branch read, without probing again or naming a branch", async () => {
    const { mb, capture } = clientOver([
      sessionProperties(
        { "remote-sync-branch": "main", "token-features": { remote_sync: false } },
        UNLICENSED_SERVER,
      ),
      premiumRefusalResponse("Remote Sync"),
    ]);

    const error = await thrownBy(() => mb.gitSync.import());

    assert(error instanceof CapabilityError, "expected CapabilityError");
    expect(error.developerDetail).toEqual({
      reason: "missing-token-feature",
      detail:
        "This operation requires the 'remote_sync' premium feature (not enabled on this server).",
      feature: "remoteSync",
      since: 58,
      tokenFeature: "remote_sync",
      serverVersion: "v1.63.0",
    });
    expect(capture.calls.map((call) => [call.url, call.body])).toEqual([
      [PROBE_URL, null],
      ["https://mb.example.com/metabase/api/ee/remote-sync/import", "{}"],
    ]);
  });

  it("returns the started import without a final task when no wait is given", async () => {
    const { mb } = clientOver([
      trackedBranchResponse("main"),
      jsonResponse({ status: "success", task_id: 12, message: "Import queued" }),
    ]);

    expect(await mb.gitSync.import()).toEqual({ message: "Import queued", task_id: 12 });
  });

  it("polls the current task after the import POST when a wait schedule is given", async () => {
    const { mb, capture } = clientOver([
      trackedBranchResponse("main"),
      jsonResponse({ status: "success", task_id: 12, message: "Import queued" }),
      jsonResponse(RUNNING_TASK),
      jsonResponse(SETTLED_TASK),
    ]);

    await mb.gitSync.import({ wait: IMMEDIATE_POLL });

    expect(capture.calls).toEqual([
      PROPERTIES_READ,
      {
        url: "https://mb.example.com/metabase/api/ee/remote-sync/import",
        method: "POST",
        headers: JSON_WRITE_HEADERS,
        body: '{"expected_branch":"main"}',
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
      trackedBranchResponse("main"),
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
      trackedBranchResponse("main"),
      jsonResponse({ status: "success", task_id: null, message: "Already up to date" }),
    ]);

    await mb.gitSync.import({ wait: IMMEDIATE_POLL });

    expect(capture.calls).toEqual([
      PROPERTIES_READ,
      {
        url: "https://mb.example.com/metabase/api/ee/remote-sync/import",
        method: "POST",
        headers: JSON_WRITE_HEADERS,
        body: '{"expected_branch":"main"}',
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

  it("sends the tracked branch as the export's branch when none is given", async () => {
    const { mb, capture } = clientOver([
      trackedBranchResponse("main"),
      jsonResponse({ message: "Export queued", task_id: 8 }),
    ]);

    await mb.gitSync.export({ message: "update dashboards" });

    expect(capture.calls.map((call) => call.body)).toEqual([
      null,
      '{"branch":"main","message":"update dashboards"}',
    ]);
  });

  it("reports the settled task alongside the export that started it", async () => {
    const { mb } = clientOver([
      trackedBranchResponse("main"),
      jsonResponse({ message: "Export queued", task_id: 8 }),
      jsonResponse(SETTLED_TASK),
    ]);

    expect(await mb.gitSync.export({ wait: IMMEDIATE_POLL })).toEqual({
      message: "Export queued",
      task_id: 8,
      final: SETTLED_TASK,
    });
  });

  it("sends the export preflight request with the branch as a query parameter", async () => {
    const { mb, capture } = clientOver([jsonResponse(CLEAN_PREFLIGHT)], SERVER_WITH_PREFLIGHT);

    await mb.gitSync.exportPreflight({ branch: "feature/a b" });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/ee/remote-sync/export-preflight?branch=feature%2Fa+b",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("answers the export preflight as the server's merge preview", async () => {
    const diverged = {
      has_changes: true,
      clean: false,
      conflicts: ["Card: Orders"],
      summary: { added: 1, updated: 2, removed: 0 },
      force_push_casualties: { deleted: ["Dashboard: KPIs"], overwritten: ["Card: Orders"] },
      reason: "history-rewritten",
    };
    const { mb } = clientOver([jsonResponse(diverged)], SERVER_WITH_PREFLIGHT);

    expect(await mb.gitSync.exportPreflight({ branch: "main" })).toEqual(diverged);
  });

  it("explains an unrouted export preflight on a server older than the route", async () => {
    const { mb, capture } = clientOver([routeMissingResponse(), probeResponse(SERVER)]);

    const error = await thrownBy(() => mb.gitSync.exportPreflight({ branch: "main" }));

    assert(error instanceof CapabilityError, "expected CapabilityError");
    expect(error.developerDetail).toEqual({
      reason: "version-too-old",
      detail:
        "This operation requires Metabase v63+ (this server is v1.60.0). Upgrade Metabase to use it.",
      feature: "remoteSyncExportPreflight",
      since: 63,
      tokenFeature: "remote_sync",
      serverVersion: "v1.60.0",
    });
    expect(capture.calls.map((call) => call.url)).toEqual([
      "https://mb.example.com/metabase/api/ee/remote-sync/export-preflight?branch=main",
      PROBE_URL,
    ]);
  });

  it("explains a refused preflight of the tracked branch by the branch read, in two requests", async () => {
    const { mb, capture } = clientOver(
      [trackedBranchResponse("main", SERVER), routeMissingResponse()],
      SERVER_WITH_PREFLIGHT,
    );

    const error = await thrownBy(async () =>
      mb.gitSync.exportPreflight({ branch: await mb.gitSync.trackedBranch() }),
    );

    assert(error instanceof CapabilityError, "expected CapabilityError");
    expect(error.developerDetail.feature).toBe("remoteSyncExportPreflight");
    expect(capture.calls.map((call) => call.url)).toEqual([
      PROBE_URL,
      "https://mb.example.com/metabase/api/ee/remote-sync/export-preflight?branch=main",
    ]);
  });

  it("surfaces a branch mismatch as the server's conflict answer", async () => {
    const { mb } = clientOver(
      [
        jsonResponse(
          {
            message: "The sync branch changed to 'main' in another session. Refresh and try again.",
            branch_mismatch: true,
            current_branch: "main",
          },
          409,
        ),
      ],
      SERVER_WITH_PREFLIGHT,
    );

    const error = await thrownBy(() => mb.gitSync.exportPreflight({ branch: "stale" }));

    assert(error instanceof HttpError, "expected HttpError");
    expect(error.status).toBe(409);
    expect(error.message).toBe(
      "The sync branch changed to 'main' in another session. Refresh and try again.",
    );
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

  it("reads the synced collections off the collection listing", async () => {
    const { mb, capture } = clientOver([
      sessionProperties({ "token-features": { remote_sync: true } }),
      jsonResponse([]),
    ]);

    await mb.gitSync.syncedCollections();

    expect(capture.calls).toEqual([
      PROPERTIES_READ,
      {
        url: "https://mb.example.com/metabase/api/collection",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("keeps only the collections the server flagged for sync", async () => {
    const synced = { id: 4, name: "Ops", is_remote_synced: true };
    const { mb } = clientOver([
      sessionProperties({ "token-features": { remote_sync: true } }),
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
      sessionProperties({ "token-features": { remote_sync: true } }),
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

  it("reads the tracked branch off the session properties", async () => {
    const { mb, capture } = clientOver([trackedBranchResponse("main")]);

    await mb.gitSync.branch();

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/session/properties",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("answers the effective branch, an environment-set one included", async () => {
    const { mb } = clientOver([trackedBranchResponse("main")]);

    expect(await mb.gitSync.branch()).toBe("main");
  });

  it("reads an unconfigured branch setting's null as no branch", async () => {
    const { mb } = clientOver([
      sessionProperties({ "remote-sync-branch": null, "token-features": { remote_sync: true } }),
    ]);

    expect(await mb.gitSync.branch()).toBeNull();
  });

  it("refuses rather than reading a setting the caller may not see as unset", async () => {
    const { mb } = clientOver([
      sessionProperties({ "site-name": "Metabase", "token-features": { remote_sync: true } }),
    ]);

    const error = await thrownBy(() => mb.gitSync.branch());

    expect(error).toBeInstanceOf(ConfigError);
    assert(error instanceof ConfigError, "expected ConfigError");
    expect(error.message).toBe(
      "the remote-sync-branch setting is not readable: it is visible to admins only",
    );
  });

  it("rethrows a permission failure on the properties rather than reading it as unset", async () => {
    const { mb } = clientOver([jsonResponse({ message: "You don't have permissions" }, 403)]);

    const error = await thrownBy(() => mb.gitSync.branch({ retries: 0 }));

    expect(error).toBeInstanceOf(HttpError);
    assert(error instanceof HttpError, "expected HttpError");
    expect(error.status).toBe(403);
  });

  it("rethrows a branch failure that is neither a permission nor a registration answer", async () => {
    const { mb } = clientOver([jsonResponse({ message: "boom" }, 500)]);

    const error = await thrownBy(() => mb.gitSync.branch({ retries: 0 }));

    expect(error).toBeInstanceOf(HttpError);
    assert(error instanceof HttpError, "expected HttpError");
    expect(error.message).toBe("boom");
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
