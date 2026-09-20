import { assert, describe, expect, it } from "vitest";

import { createClient } from "../client";
import { ResponseShapeError } from "../errors";
import type { ClientCredentials } from "../http/transport";
import {
  captureFetch,
  type FetchScript,
  jsonResponse,
  TEST_USER_AGENT,
} from "../testing/fetch-capture";
import { CapabilityError } from "../version/preflight-error";
import { createServerProfile, type ServerProfile } from "../version/profile";

const CREDENTIALS: ClientCredentials = {
  url: "https://mb.example.com/metabase",
  credential: { kind: "apiKey", apiKey: "mb_wire_test_key" },
};

const SOURCE = {
  type: "query",
  query: { database: 1, type: "native", native: { query: "select 1" } },
} as const;

const TARGET = { type: "table", database: 1, schema: "public", name: "daily_orders" } as const;

const TRANSFORM = {
  id: 7,
  name: "Daily orders",
  description: null,
  source: SOURCE,
  target: TARGET,
  source_type: "native",
  entity_id: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  creator_id: 1,
  collection_id: null,
};

const TRANSFORM_WITH_TARGET_TABLE_ID = { ...TRANSFORM, target_table_id: 42 };

const TRANSFORM_WITH_HYDRATED_TABLE = { ...TRANSFORM, table: { id: 42, name: "daily_orders" } };

const TRANSFORM_UNLINKED = { ...TRANSFORM, target_table_id: null };

const TRANSFORM_DETAIL_UNLINKED = { ...TRANSFORM, table: null };

const RUN = {
  id: 31,
  transform_id: 7,
  run_method: "manual",
  status: "started",
  is_active: true,
  start_time: "2026-01-01T00:00:00Z",
  end_time: null,
  message: null,
  user_id: 1,
};

const SUCCEEDED_RUN = {
  ...RUN,
  status: "succeeded",
  is_active: false,
  end_time: "2026-01-01T00:01:00Z",
};

const FAILED_RUN = {
  ...SUCCEEDED_RUN,
  status: "failed",
  message: "relation does not exist",
};

const KICKOFF = { message: "Transform run started", run_id: 31 };

const DAG_KICKOFF = { message: "DAG run started", dag_run_id: 90 };

const DAG_RUN_SUMMARY = {
  run_type: "dag",
  id: 90,
  entity_id: 7,
  name: "Daily orders",
  direction: "downstream",
  transform_count: 3,
  run_method: "manual",
  status: "started",
  is_active: true,
  start_time: "2026-01-01T00:00:00Z",
  end_time: null,
  message: null,
  user_id: 1,
};

const JSON_REQUEST_HEADERS = {
  accept: "application/json",
  "content-type": "application/json",
  "user-agent": TEST_USER_AGENT,
  "x-api-key": "mb_wire_test_key",
};

const JSON_READ_HEADERS = {
  accept: "application/json",
  "user-agent": TEST_USER_AGENT,
  "x-api-key": "mb_wire_test_key",
};

const BINARY_READ_HEADERS = {
  accept: "*/*",
  "user-agent": TEST_USER_AGENT,
  "x-api-key": "mb_wire_test_key",
};

const IMMEDIATE_POLL = { intervalMs: 1, timeoutMs: 1_000 };

// Short enough that the table never registers within it, and paired with a script that keeps
// answering so the wait ends on the deadline rather than on an exhausted queue.
const EXPIRING_POLL = { intervalMs: 1, timeoutMs: 5 };

// The least server that answers this resource, so a method asking for more than the resource's
// own feature is refused here before it reaches the scripted wire. It is also the generation that
// links the output table only on the detail, as a hydrated `table`.
const SERVER = createServerProfile({
  edition: "oss",
  version: { tag: "v0.59.0", major: 59, patch: 0 },
  date: null,
  hash: null,
  tokenFeatures: null,
});

// The first generation carrying `target_table_id` as a column on every transform endpoint.
const TABLE_ID_COLUMN_SERVER = createServerProfile({
  edition: "oss",
  version: { tag: "v0.61.0", major: 61, patch: 0 },
  date: null,
  hash: null,
  tokenFeatures: null,
});

// The first generation whose transform routes include the checkpoint reset.
const CHECKPOINT_SERVER = createServerProfile({
  edition: "oss",
  version: { tag: "v0.60.0", major: 60, patch: 0 },
  date: null,
  hash: null,
  tokenFeatures: null,
});

// The first generation with DAG reprocess runs and the unified run history.
const DAG_SERVER = createServerProfile({
  edition: "oss",
  version: { tag: "v0.64.0", major: 64, patch: 0 },
  date: null,
  hash: null,
  tokenFeatures: null,
});

function clientOver(responses: FetchScript, server: ServerProfile = SERVER) {
  const capture = captureFetch(responses);
  const mb = createClient(CREDENTIALS, {
    userAgent: TEST_USER_AGENT,
    fetchImpl: capture.fetch,
    server,
  });
  return { mb, capture };
}

function repeated(body: unknown, times: number): FetchScript {
  return Array.from({ length: times }, () => () => jsonResponse(body));
}

describe("transform resource wire requests", () => {
  it("sends the list request", async () => {
    const { mb, capture } = clientOver([jsonResponse([TRANSFORM])]);

    await mb.transform.list();

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/transform",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("reports no total for the listing, which the server does not count", async () => {
    const { mb } = clientOver([jsonResponse([TRANSFORM])]);

    expect(await mb.transform.list()).toEqual({ data: [TRANSFORM_UNLINKED], total: null });
  });

  it("sends the get request", async () => {
    const { mb, capture } = clientOver([jsonResponse(TRANSFORM_DETAIL_UNLINKED)]);

    await mb.transform.get(7);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/transform/7",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("sends the create request with the body it was given", async () => {
    const { mb, capture } = clientOver([jsonResponse(TRANSFORM)]);

    await mb.transform.create({ name: TRANSFORM.name, source: SOURCE, target: TARGET });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/transform",
        method: "POST",
        headers: JSON_REQUEST_HEADERS,
        body: JSON.stringify({ name: TRANSFORM.name, source: SOURCE, target: TARGET }),
      },
    ]);
  });

  it("sends the update request as a PUT carrying only the patched fields", async () => {
    const { mb, capture } = clientOver([jsonResponse({ ...TRANSFORM, name: "renamed" })]);

    await mb.transform.update(7, { name: "renamed" });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/transform/7",
        method: "PUT",
        headers: JSON_REQUEST_HEADERS,
        body: '{"name":"renamed"}',
      },
    ]);
  });

  it("sends the delete request as a bodiless DELETE accepting any content type", async () => {
    const { mb, capture } = clientOver([new Response(null, { status: 204 })]);

    await mb.transform.delete(7);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/transform/7",
        method: "DELETE",
        headers: BINARY_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("sends the output-table drop as a DELETE on the transform's table", async () => {
    const { mb, capture } = clientOver([new Response(null, { status: 204 })]);

    await mb.transform.deleteTable(7);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/transform/7/table",
        method: "DELETE",
        headers: BINARY_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("sends the cancel request as a bodiless POST accepting any content type", async () => {
    const { mb, capture } = clientOver([new Response(null, { status: 204 })]);

    await mb.transform.cancel(7);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/transform/7/cancel",
        method: "POST",
        headers: BINARY_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("sends the dependencies request", async () => {
    const { mb, capture } = clientOver([jsonResponse([TRANSFORM])]);

    expect(await mb.transform.dependencies(7)).toEqual({ data: [TRANSFORM_UNLINKED], total: null });
    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/transform/7/dependencies",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("sends the run read against the run id rather than the transform id", async () => {
    const { mb, capture } = clientOver([jsonResponse(RUN)]);

    expect(await mb.transform.getRun(31)).toEqual(RUN);
    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/transform/run/31",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("sends the run history request with the transform filter plus the paging window", async () => {
    const { mb, capture } = clientOver([jsonResponse({ data: [RUN], total: 12 })]);

    const pages = mb.transform.runPages(
      { "transform-ids": 7 },
      { offset: 10, max: 2, pageSize: 2 },
    );
    await pages[Symbol.asyncIterator]().next();

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/transform/run?transform-ids=7&limit=2&offset=10",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("sends the unified run history request with every filter repeated per value", async () => {
    const { mb, capture } = clientOver(
      [jsonResponse({ data: [DAG_RUN_SUMMARY], total: 1 })],
      DAG_SERVER,
    );

    const pages = mb.transform.runSummaryPages(
      {
        types: ["dag", "job"],
        statuses: ["started"],
        "run-methods": ["manual"],
        "start-time": "past7days",
        "transform-ids": [7, 8],
        "sort-column": "end_time",
        "sort-direction": "asc",
      },
      { max: 1, pageSize: 1 },
    );
    const first = await pages[Symbol.asyncIterator]().next();

    expect(first.value).toEqual({ items: [DAG_RUN_SUMMARY], total: 1 });
    expect(capture.calls).toEqual([
      {
        url:
          "https://mb.example.com/metabase/api/transform/runs?types=dag&types=job&statuses=started" +
          "&run-methods=manual&start-time=past7days&transform-ids=7&transform-ids=8" +
          "&sort-column=end_time&sort-direction=asc&limit=1&offset=0",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("refuses the checkpoint reset before the wire on a server without the route", async () => {
    const { mb, capture } = clientOver([]);

    const error = await mb.transform.resetCheckpoint(7).catch((caught: unknown) => caught);

    assert(error instanceof CapabilityError, "expected CapabilityError");
    expect(error.developerDetail).toEqual({
      reason: "version-too-old",
      detail:
        "This operation requires Metabase v60+ (this server is v0.59.0). Upgrade Metabase to use it.",
      feature: "transformCheckpointReset",
      since: 60,
      tokenFeature: null,
      serverVersion: "v0.59.0",
    });
    expect(capture.calls).toEqual([]);
  });

  it("sends the checkpoint reset request", async () => {
    const { mb, capture } = clientOver([new Response(null, { status: 204 })], CHECKPOINT_SERVER);

    await mb.transform.resetCheckpoint(7);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/transform/7/reset-checkpoint",
        method: "POST",
        headers: BINARY_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("starts a DAG run with the direction in the body", async () => {
    const { mb, capture } = clientOver([jsonResponse(DAG_KICKOFF, 202)], DAG_SERVER);

    expect(await mb.transform.runDag(7, { direction: "downstream" })).toEqual(DAG_KICKOFF);
    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/transform/7/run-dag",
        method: "POST",
        headers: JSON_REQUEST_HEADERS,
        body: JSON.stringify({ direction: "downstream" }),
      },
    ]);
  });

  it("previews the DAG transforms with the direction in the query", async () => {
    const { mb, capture } = clientOver(
      [
        jsonResponse([
          { id: 5, name: "Raw orders" },
          { id: 7, name: "Daily orders" },
        ]),
      ],
      DAG_SERVER,
    );

    expect(await mb.transform.dagTransforms(7, { direction: "upstream" })).toEqual({
      data: [
        { id: 5, name: "Raw orders" },
        { id: 7, name: "Daily orders" },
      ],
      total: null,
    });
    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/transform/7/dag-transforms?direction=upstream",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("refuses a DAG run before the wire on a server without DAG runs", async () => {
    const { mb, capture } = clientOver([]);

    const error = await mb.transform
      .runDag(7, { direction: "downstream" })
      .catch((caught: unknown) => caught);

    assert(error instanceof CapabilityError, "expected CapabilityError");
    expect(error.developerDetail).toEqual({
      reason: "version-too-old",
      detail:
        "This operation requires Metabase v64+ (this server is v0.59.0). Upgrade Metabase to use it.",
      feature: "transformDagRuns",
      since: 64,
      tokenFeature: null,
      serverVersion: "v0.59.0",
    });
    expect(capture.calls).toEqual([]);
  });

  it("starts a run and returns without polling when no wait is given", async () => {
    const { mb, capture } = clientOver([jsonResponse(KICKOFF)]);

    expect(await mb.transform.run(7)).toEqual({
      message: "Transform run started",
      run_id: 31,
      final: null,
    });
    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/transform/7/run",
        method: "POST",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("polls the run to a terminal status when a wait schedule is given", async () => {
    const { mb, capture } = clientOver([
      jsonResponse(KICKOFF),
      jsonResponse(RUN),
      jsonResponse(SUCCEEDED_RUN),
    ]);

    expect(await mb.transform.run(7, { wait: IMMEDIATE_POLL })).toEqual({
      message: "Transform run started",
      run_id: 31,
      final: SUCCEEDED_RUN,
    });
    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/transform/7/run",
        method: "POST",
        headers: JSON_READ_HEADERS,
        body: null,
      },
      {
        url: "https://mb.example.com/metabase/api/transform/run/31",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
      {
        url: "https://mb.example.com/metabase/api/transform/run/31",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("does not poll a run the server never started", async () => {
    const { mb, capture } = clientOver([
      jsonResponse({ message: "Transform run started", run_id: null }),
    ]);

    expect(await mb.transform.run(7, { wait: IMMEDIATE_POLL })).toEqual({
      message: "Transform run started",
      run_id: null,
      final: null,
    });
    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/transform/7/run",
        method: "POST",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("reads the output table off the target_table_id column where the server has one", async () => {
    const { mb } = clientOver(
      [
        jsonResponse(KICKOFF),
        jsonResponse(SUCCEEDED_RUN),
        jsonResponse(TRANSFORM_WITH_TARGET_TABLE_ID),
      ],
      TABLE_ID_COLUMN_SERVER,
    );

    expect(await mb.transform.run(7, { wait: IMMEDIATE_POLL, syncTarget: true })).toEqual({
      message: "Transform run started",
      run_id: 31,
      final: SUCCEEDED_RUN,
      target_table_id: 42,
    });
  });

  it("reads the output table off the hydrated table where the server links it that way", async () => {
    const { mb } = clientOver([
      jsonResponse(KICKOFF),
      jsonResponse(SUCCEEDED_RUN),
      jsonResponse(TRANSFORM_WITH_HYDRATED_TABLE),
    ]);

    expect(await mb.transform.run(7, { wait: IMMEDIATE_POLL, syncTarget: true })).toEqual({
      message: "Transform run started",
      run_id: 31,
      final: SUCCEEDED_RUN,
      target_table_id: 42,
    });
  });

  it("waits for the run itself when only the output table was asked for", async () => {
    const { mb, capture } = clientOver([
      jsonResponse(KICKOFF),
      jsonResponse(SUCCEEDED_RUN),
      jsonResponse(TRANSFORM_WITH_HYDRATED_TABLE),
    ]);

    await mb.transform.run(7, { syncTarget: true });

    expect(capture.calls.map((call) => call.url)).toEqual([
      "https://mb.example.com/metabase/api/transform/7/run",
      "https://mb.example.com/metabase/api/transform/run/31",
      "https://mb.example.com/metabase/api/transform/7",
    ]);
  });

  it("reports no output table for a run that failed, without waiting for one", async () => {
    const { mb, capture } = clientOver([jsonResponse(KICKOFF), jsonResponse(FAILED_RUN)]);

    expect(await mb.transform.run(7, { wait: IMMEDIATE_POLL, syncTarget: true })).toEqual({
      message: "Transform run started",
      run_id: 31,
      final: FAILED_RUN,
      target_table_id: null,
    });
    expect(capture.calls.map((call) => call.url)).toEqual([
      "https://mb.example.com/metabase/api/transform/7/run",
      "https://mb.example.com/metabase/api/transform/run/31",
    ]);
  });

  it("reports no output table when the wait runs out before the table is registered", async () => {
    const { mb } = clientOver([
      jsonResponse(KICKOFF),
      jsonResponse(SUCCEEDED_RUN),
      ...repeated(TRANSFORM_DETAIL_UNLINKED, 50),
    ]);

    expect(await mb.transform.run(7, { wait: EXPIRING_POLL, syncTarget: true })).toEqual({
      message: "Transform run started",
      run_id: 31,
      final: SUCCEEDED_RUN,
      target_table_id: null,
    });
  });

  it("refuses a detail without the target_table_id column on a server that has one", async () => {
    const { mb } = clientOver(
      [jsonResponse(TRANSFORM_WITH_HYDRATED_TABLE)],
      TABLE_ID_COLUMN_SERVER,
    );

    const error = await mb.transform.get(7).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ResponseShapeError);
    assert(error instanceof ResponseShapeError, "expected ResponseShapeError");
    expect(error.userMessage).toBe(
      "On Metabase v0.61.0 the response shape was unexpected:\n" +
        "  target_table_id: Invalid input: expected number, received undefined",
    );
  });

  it("refuses a detail without the hydrated table on a server that links it that way", async () => {
    const { mb } = clientOver([jsonResponse(TRANSFORM_WITH_TARGET_TABLE_ID)]);

    const error = await mb.transform.get(7).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ResponseShapeError);
    assert(error instanceof ResponseShapeError, "expected ResponseShapeError");
    expect(error.userMessage).toBe(
      "On Metabase v0.59.0 the response shape was unexpected:\n" +
        "  table: Invalid input: expected object, received undefined",
    );
  });
});
