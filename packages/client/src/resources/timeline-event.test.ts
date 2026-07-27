import { describe, expect, it } from "vitest";

import { createClient } from "../client";
import type { ClientCredentials } from "../http/transport";
import { captureFetch, jsonResponse, TEST_USER_AGENT } from "../testing/fetch-capture";

const CREDENTIALS: ClientCredentials = {
  url: "https://mb.example.com/metabase",
  credential: { kind: "apiKey", apiKey: "mb_wire_test_key" },
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

describe("timeline-event resource wire requests", () => {
  it("sends the get request", async () => {
    const { mb, capture } = clientOver([jsonResponse(EVENT)]);

    await mb.timelineEvent.get(11);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/timeline-event/11",
        method: "GET",
        headers: JSON_READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("sends the create request with the body as JSON", async () => {
    const { mb, capture } = clientOver([jsonResponse(EVENT)]);

    await mb.timelineEvent.create({
      name: "v2 launch",
      timestamp: "2026-07-01T00:00:00Z",
      timezone: "UTC",
      time_matters: false,
      timeline_id: 3,
    });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/timeline-event",
        method: "POST",
        headers: JSON_REQUEST_HEADERS,
        body: '{"name":"v2 launch","timestamp":"2026-07-01T00:00:00Z","timezone":"UTC","time_matters":false,"timeline_id":3}',
      },
    ]);
  });

  it("sends the update request as a PUT carrying only the patched fields", async () => {
    const { mb, capture } = clientOver([jsonResponse(EVENT)]);

    await mb.timelineEvent.update(11, { name: "v2.1 launch" });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/timeline-event/11",
        method: "PUT",
        headers: JSON_REQUEST_HEADERS,
        body: '{"name":"v2.1 launch"}',
      },
    ]);
  });

  it("sends the archive request as the same PUT with archived set", async () => {
    const { mb, capture } = clientOver([jsonResponse({ ...EVENT, archived: true })]);

    await mb.timelineEvent.archive(11);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/timeline-event/11",
        method: "PUT",
        headers: JSON_REQUEST_HEADERS,
        body: '{"archived":true}',
      },
    ]);
  });

  // `archive` writes a patch it did not receive, so the value it hands back has to be the server's
  // answer rather than the body it sent or the event as it stood before the write.
  it("returns the archived event the server answered with", async () => {
    const { mb } = clientOver([jsonResponse({ ...EVENT, archived: true })]);

    expect(await mb.timelineEvent.archive(11)).toEqual({ ...EVENT, archived: true });
  });

  it("sends the delete request as a bodiless DELETE accepting any content type", async () => {
    const { mb, capture } = clientOver([new Response(null, { status: 204 })]);

    await mb.timelineEvent.delete(11);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/timeline-event/11",
        method: "DELETE",
        headers: BINARY_READ_HEADERS,
        body: null,
      },
    ]);
  });
});
