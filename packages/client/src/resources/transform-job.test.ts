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
import { KNOWN_RANGE } from "../version/known-range";
import { createServerProfile, type ServerProfile } from "../version/profile";

const CREDENTIALS: ClientCredentials = {
  url: "https://mb.example.com/metabase",
  credential: { kind: "apiKey", apiKey: "mb_wire_test_key" },
};

const SCHEDULE = "0 0 0 * * ?";

const JOB = {
  id: 3,
  name: "Nightly",
  description: null,
  schedule: SCHEDULE,
  ui_display_type: "cron/raw",
  active: true,
  entity_id: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const TRANSFORM = {
  id: 7,
  name: "Daily orders",
  description: null,
  source: { type: "query", query: { database: 1, type: "native", native: { query: "select 1" } } },
  target: { type: "table", database: 1, schema: "public", name: "daily_orders" },
  source_type: "native",
  entity_id: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  creator_id: 1,
  collection_id: null,
  target_table_id: 42,
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

// The least server that answers this resource, so a method asking for more than the resource's
// own feature is refused here before it reaches the scripted wire. It is also of the generation
// that answers a job run with an opaque stub id.
const SERVER = createServerProfile({
  edition: "oss",
  version: { tag: "v0.61.0", major: 61, patch: 0 },
  date: null,
  hash: null,
  tokenFeatures: null,
});

// A head build past the known window, the generation answering a job run with the run's numeric
// id, or null for no run.
const NUMERIC_RUN_ID_MAJOR = KNOWN_RANGE.max + 1;
const NUMERIC_RUN_ID_SERVER = createServerProfile({
  edition: "oss",
  version: { tag: `v0.${NUMERIC_RUN_ID_MAJOR}.0`, major: NUMERIC_RUN_ID_MAJOR, patch: 0 },
  date: null,
  hash: null,
  tokenFeatures: null,
});

const STUB_RUN_RESPONSE = { message: "Job run started", job_run_id: "stub-3-1767225600000" };
const NUMERIC_RUN_RESPONSE = { message: "Job run started", job_run_id: 11 };

function clientOver(responses: FetchScript, server: ServerProfile = SERVER) {
  const capture = captureFetch(responses);
  const mb = createClient(CREDENTIALS, {
    userAgent: TEST_USER_AGENT,
    fetchImpl: capture.fetch,
    server,
  });
  return { mb, capture };
}

describe("transform-job resource wire requests", () => {
  it("sends the list request", async () => {
    const { mb, capture } = clientOver([jsonResponse([JOB])]);

    await mb.transformJob.list();

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/transform-job",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("reports no total for the listing, which the server does not count", async () => {
    const { mb } = clientOver([jsonResponse([JOB])]);

    expect(await mb.transformJob.list()).toEqual({ data: [JOB], total: null });
  });

  it("sends the get request", async () => {
    const { mb, capture } = clientOver([jsonResponse(JOB)]);

    await mb.transformJob.get(3);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/transform-job/3",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("sends the create request with the body it was given", async () => {
    const { mb, capture } = clientOver([jsonResponse(JOB)]);

    await mb.transformJob.create({ name: JOB.name, schedule: SCHEDULE });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/transform-job",
        method: "POST",
        headers: JSON_REQUEST_HEADERS,
        body: JSON.stringify({ name: JOB.name, schedule: SCHEDULE }),
      },
    ]);
  });

  it("sends the update request as a PUT carrying only the patched fields", async () => {
    const { mb, capture } = clientOver([jsonResponse({ ...JOB, name: "renamed" })]);

    await mb.transformJob.update(3, { name: "renamed" });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/transform-job/3",
        method: "PUT",
        headers: JSON_REQUEST_HEADERS,
        body: '{"name":"renamed"}',
      },
    ]);
  });

  it("sends the delete request as a bodiless DELETE accepting any content type", async () => {
    const { mb, capture } = clientOver([new Response(null, { status: 204 })]);

    await mb.transformJob.delete(3);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/transform-job/3",
        method: "DELETE",
        headers: BINARY_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("sends the run request as a POST carrying the run_all flag", async () => {
    const { mb, capture } = clientOver([jsonResponse(STUB_RUN_RESPONSE)]);

    await mb.transformJob.run(3, { run_all: true });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/transform-job/3/run",
        method: "POST",
        headers: JSON_REQUEST_HEADERS,
        body: '{"run_all":true}',
      },
    ]);
  });

  it("refuses a numeric run id from a server that answers a stub", async () => {
    const { mb } = clientOver([jsonResponse(NUMERIC_RUN_RESPONSE)]);

    const error = await mb.transformJob.run(3).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ResponseShapeError);
    assert(error instanceof ResponseShapeError, "expected ResponseShapeError");
    expect(error.userMessage).toBe(
      "On Metabase v0.61.0 the response shape was unexpected:\n" +
        "  job_run_id: Invalid input: expected string, received number",
    );
  });

  it("refuses a stub run id from a server that answers a number", async () => {
    const { mb } = clientOver([jsonResponse(STUB_RUN_RESPONSE)], NUMERIC_RUN_ID_SERVER);

    const error = await mb.transformJob.run(3).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ResponseShapeError);
    assert(error instanceof ResponseShapeError, "expected ResponseShapeError");
    expect(error.userMessage).toBe(
      `On Metabase v0.${NUMERIC_RUN_ID_MAJOR}.0 (newer than this client supports, up to v${KNOWN_RANGE.max}) the response shape was unexpected:\n` +
        "  job_run_id: Invalid input: expected number, received string",
    );
  });

  it("sends the transforms request against the job id", async () => {
    const { mb, capture } = clientOver([jsonResponse([TRANSFORM])]);

    expect(await mb.transformJob.transforms(3)).toEqual({ data: [TRANSFORM], total: null });
    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/transform-job/3/transforms",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("sends set-active against the idless active path, not the job path", async () => {
    const { mb, capture } = clientOver([jsonResponse({ updated: 2, failed: 0 })]);

    expect(await mb.transformJob.setActive(false)).toEqual({ updated: 2, failed: 0 });
    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/transform-job/active",
        method: "PUT",
        headers: JSON_REQUEST_HEADERS,
        body: '{"active":false}',
      },
    ]);
  });
});
