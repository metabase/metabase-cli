import { assert, describe, expect, it } from "vitest";

import { createClient } from "../client";
import { HttpError } from "../http/errors";
import type { ClientCredentials } from "../http/transport";
import { captureFetch, jsonResponse, TEST_USER_AGENT, thrownBy } from "../testing/fetch-capture";
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

// The least server that answers this resource, so a method asking for more than the resource's
// own feature is refused here before it reaches the scripted wire.
const SERVER = createServerProfile({
  edition: "ee",
  version: { tag: "v1.60.0", major: 60, patch: 0 },
  date: null,
  hash: null,
  tokenFeatures: { remote_sync: true },
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

  it("reports no branch when the caller may not read settings", async () => {
    const { mb } = clientOver([jsonResponse({ message: "You don't have permissions" }, 403)]);

    expect(await mb.gitSync.branch()).toBeNull();
  });

  it("reports no branch when the setting is not registered on the server", async () => {
    const { mb } = clientOver([jsonResponse({ message: "Not found." }, 404)]);

    expect(await mb.gitSync.branch()).toBeNull();
  });

  it("rethrows a branch failure that is neither a permission nor a registration answer", async () => {
    const { mb } = clientOver([jsonResponse({ message: "boom" }, 500)]);

    const error = await thrownBy(() => mb.gitSync.branch({ retries: 0 }));

    expect(error).toBeInstanceOf(HttpError);
    assert(error instanceof HttpError, "expected HttpError");
    expect(error.message).toBe("boom");
  });

  it("stops waiting on an import at once when the server reports no task", async () => {
    const { mb } = clientOver([
      jsonResponse({ status: "success", task_id: 12, message: "Import queued" }),
      noContent(),
    ]);

    expect(await mb.gitSync.import({ wait: IMMEDIATE_POLL })).toEqual({
      message: "Import queued",
      task_id: 12,
      final: null,
    });
  });
});
