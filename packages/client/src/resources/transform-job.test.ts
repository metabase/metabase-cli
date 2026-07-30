import { describe, expect, it } from "vitest";

import { createClient } from "../client";
import type { ClientCredentials } from "../http/transport";
import {
  captureFetch,
  type FetchScript,
  jsonResponse,
  TEST_USER_AGENT,
} from "../testing/fetch-capture";

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

function clientOver(responses: FetchScript) {
  const capture = captureFetch(responses);
  const mb = createClient(CREDENTIALS, {
    userAgent: TEST_USER_AGENT,
    fetchImpl: capture.fetch,
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
    const { mb, capture } = clientOver([
      jsonResponse({ message: "Job run started", job_run_id: 11 }),
    ]);

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

  it("reads the numeric run id head answers", async () => {
    const { mb } = clientOver([jsonResponse({ message: "Job run started", job_run_id: 11 })]);

    expect(await mb.transformJob.run(3)).toEqual({ message: "Job run started", job_run_id: 11 });
  });

  it("reads the opaque stub id released servers answer", async () => {
    const { mb } = clientOver([
      jsonResponse({ message: "Job run started", job_run_id: "job-3-1767225600000" }),
    ]);

    expect(await mb.transformJob.run(3)).toEqual({
      message: "Job run started",
      job_run_id: "job-3-1767225600000",
    });
  });

  it("reads the null run id a server answers when it started nothing", async () => {
    const { mb } = clientOver([jsonResponse({ message: "Job run started", job_run_id: null })]);

    expect(await mb.transformJob.run(3)).toEqual({ message: "Job run started", job_run_id: null });
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
