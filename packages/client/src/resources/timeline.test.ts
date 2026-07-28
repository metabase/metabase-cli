import { describe, expect, it } from "vitest";

import { createClient } from "../client";
import type { ClientCredentials } from "../http/transport";
import { captureFetch, jsonResponse, TEST_USER_AGENT } from "../testing/fetch-capture";

const CREDENTIALS: ClientCredentials = {
  url: "https://mb.example.com/metabase",
  credential: { kind: "apiKey", apiKey: "mb_wire_test_key" },
};

const TIMELINE = {
  id: 3,
  name: "Releases",
  description: null,
  icon: "star",
  collection_id: null,
  archived: false,
  default: false,
  creator_id: 1,
  entity_id: "aaaaaaaaaaaaaaaaaaaaa",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const EVENT = {
  id: 11,
  name: "v2 launch",
  description: null,
  timestamp: "2026-07-01T00:00:00Z",
  timezone: "UTC",
  time_matters: false,
  icon: "star",
  timeline_id: 3,
  archived: false,
  creator_id: 1,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
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

function clientOver(responses: Array<Response>) {
  const capture = captureFetch(responses);
  const mb = createClient(CREDENTIALS, {
    userAgent: TEST_USER_AGENT,
    fetchImpl: capture.fetch,
  });
  return { mb, capture };
}

describe("timeline resource wire requests", () => {
  it("sends the list request with the archived parameter", async () => {
    const { mb, capture } = clientOver([jsonResponse([TIMELINE])]);

    await mb.timeline.list({ archived: true });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/timeline?archived=true",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("omits an unset archived parameter from the query string", async () => {
    const { mb, capture } = clientOver([jsonResponse([TIMELINE])]);

    await mb.timeline.list();

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/timeline",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("reports no server count for the bare-array listing", async () => {
    const { mb } = clientOver([jsonResponse([TIMELINE])]);

    const result = await mb.timeline.list();

    expect(result).toEqual({ data: [TIMELINE], total: null });
  });

  it("sends the get request without asking for events", async () => {
    const { mb, capture } = clientOver([jsonResponse(TIMELINE)]);

    await mb.timeline.get(3);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/timeline/3",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("sends the events request as the timeline read that hydrates them", async () => {
    const { mb, capture } = clientOver([jsonResponse({ ...TIMELINE, events: [EVENT] })]);

    await mb.timeline.events(3, { archived: true });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/timeline/3?include=events&archived=true",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("returns the hydrated events rather than the timeline that carried them", async () => {
    const { mb } = clientOver([jsonResponse({ ...TIMELINE, events: [EVENT] })]);

    const result = await mb.timeline.events(3);

    expect(result).toEqual({ data: [EVENT], total: null });
  });

  it("sends the create request with the body as JSON", async () => {
    const { mb, capture } = clientOver([jsonResponse(TIMELINE)]);

    await mb.timeline.create({ name: "Releases" });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/timeline",
        method: "POST",
        headers: JSON_REQUEST_HEADERS,
        body: '{"name":"Releases"}',
      },
    ]);
  });

  it("sends the update request as a PUT carrying only the patched fields", async () => {
    const { mb, capture } = clientOver([jsonResponse(TIMELINE)]);

    await mb.timeline.update(3, { name: "Product releases" });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/timeline/3",
        method: "PUT",
        headers: JSON_REQUEST_HEADERS,
        body: '{"name":"Product releases"}',
      },
    ]);
  });

  it("sends the archive request as the same PUT with archived set", async () => {
    const { mb, capture } = clientOver([jsonResponse({ ...TIMELINE, archived: true })]);

    await mb.timeline.archive(3);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/timeline/3",
        method: "PUT",
        headers: JSON_REQUEST_HEADERS,
        body: '{"archived":true}',
      },
    ]);
  });

  it("sends the delete request as a bodiless DELETE accepting any content type", async () => {
    const { mb, capture } = clientOver([new Response(null, { status: 204 })]);

    await mb.timeline.delete(3);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/timeline/3",
        method: "DELETE",
        headers: BINARY_READ_HEADERS,
        body: null,
      },
    ]);
  });
});
