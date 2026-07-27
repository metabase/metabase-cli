import { describe, expect, it } from "vitest";

import { createClient } from "../client";
import { Pulse, type PulseUpdateInput } from "../domain/pulse";
import type { ClientCredentials } from "../http/transport";
import { captureFetch, jsonResponse, TEST_USER_AGENT } from "../testing/fetch-capture";

import { mergePulseUpdate } from "./pulse";

const CREDENTIALS: ClientCredentials = {
  url: "https://mb.example.com/metabase",
  credential: { kind: "apiKey", apiKey: "mb_wire_test_key" },
};

const READ_HEADERS = {
  accept: "application/json",
  "user-agent": TEST_USER_AGENT,
  "x-api-key": "mb_wire_test_key",
};

const JSON_REQUEST_HEADERS = {
  accept: "application/json",
  "content-type": "application/json",
  "user-agent": TEST_USER_AGENT,
  "x-api-key": "mb_wire_test_key",
};

const STORED = Pulse.parse({
  id: 1,
  name: "Weekly orders",
  creator_id: 2,
  dashboard_id: 10,
  collection_id: 3,
  archived: false,
  skip_if_empty: true,
  parameters: [],
  cards: [
    {
      id: 94,
      name: "Orders",
      dashboard_card_id: 87,
      include_csv: false,
      include_xls: false,
    },
  ],
  channels: [
    {
      id: 5,
      channel_type: "email",
      enabled: true,
      schedule_type: "daily",
      schedule_hour: 8,
      schedule_day: null,
      schedule_frame: null,
      recipients: [{ id: null, email: "team@example.com" }],
    },
  ],
});

const STORED_ARCHIVED: Pulse = { ...STORED, archived: true };

function clientOver(responses: Array<Response>) {
  const capture = captureFetch(responses);
  const mb = createClient(CREDENTIALS, {
    userAgent: TEST_USER_AGENT,
    fetchImpl: capture.fetch,
  });
  return { mb, capture };
}

describe("pulse resource wire requests", () => {
  it("sends the list request without a query string", async () => {
    const { mb, capture } = clientOver([jsonResponse([STORED])]);

    await mb.pulse.list();

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/pulse",
        method: "GET",
        headers: READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("narrows the listing to one dashboard's archived subscriptions", async () => {
    const { mb, capture } = clientOver([jsonResponse([])]);

    await mb.pulse.list({ dashboard_id: 10, archived: true });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/pulse?dashboard_id=10&archived=true",
        method: "GET",
        headers: READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("sends the get request", async () => {
    const { mb, capture } = clientOver([jsonResponse(STORED)]);

    await mb.pulse.get(1);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/pulse/1",
        method: "GET",
        headers: READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("sends the create request with the body as JSON", async () => {
    const { mb, capture } = clientOver([jsonResponse(STORED)]);

    await mb.pulse.create({
      name: "Weekly orders",
      dashboard_id: 10,
      cards: [{ id: 94, include_csv: false, include_xls: false }],
      channels: [{ channel_type: "email", enabled: true, schedule_type: "daily" }],
    });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/pulse",
        method: "POST",
        headers: JSON_REQUEST_HEADERS,
        body: '{"name":"Weekly orders","dashboard_id":10,"cards":[{"id":94,"include_csv":false,"include_xls":false}],"channels":[{"channel_type":"email","enabled":true,"schedule_type":"daily"}]}',
      },
    ]);
  });

  it("reads the stored subscription before PUTting the merged body", async () => {
    const { mb, capture } = clientOver([jsonResponse(STORED), jsonResponse(STORED)]);

    await mb.pulse.update(1, { name: "Daily orders" });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/pulse/1",
        method: "GET",
        headers: READ_HEADERS,
        body: null,
      },
      {
        url: "https://mb.example.com/metabase/api/pulse/1",
        method: "PUT",
        headers: JSON_REQUEST_HEADERS,
        body: '{"name":"Daily orders","archived":false,"skip_if_empty":true}',
      },
    ]);
  });

  it("archives by carrying the stored skip_if_empty forward alongside archived", async () => {
    const { mb, capture } = clientOver([
      jsonResponse(STORED),
      jsonResponse({ ...STORED, archived: true }),
    ]);

    await mb.pulse.archive(1);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/pulse/1",
        method: "GET",
        headers: READ_HEADERS,
        body: null,
      },
      {
        url: "https://mb.example.com/metabase/api/pulse/1",
        method: "PUT",
        headers: JSON_REQUEST_HEADERS,
        body: '{"archived":true,"skip_if_empty":true}',
      },
    ]);
  });
});

describe("mergePulseUpdate", () => {
  it("carries archived and skip_if_empty forward, which the server would otherwise default to false", () => {
    expect(mergePulseUpdate(STORED_ARCHIVED, { name: "Daily orders" })).toEqual({
      name: "Daily orders",
      archived: true,
      skip_if_empty: true,
    });
  });

  it("lets the caller override both of the server-defaulted fields", () => {
    expect(mergePulseUpdate(STORED, { archived: true, skip_if_empty: false })).toEqual({
      archived: true,
      skip_if_empty: false,
    });
  });

  it("passes the caller's other fields through untouched", () => {
    const channels: NonNullable<PulseUpdateInput["channels"]> = [
      {
        channel_type: "email",
        enabled: true,
        schedule_type: "weekly",
        schedule_hour: 6,
        schedule_day: "mon",
        recipients: [{ email: "team@example.com" }],
      },
    ];

    expect(mergePulseUpdate(STORED, { channels })).toEqual({
      channels,
      archived: false,
      skip_if_empty: true,
    });
  });
});
