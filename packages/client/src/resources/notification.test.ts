import { describe, expect, it } from "vitest";

import { createClient } from "../client";
import { Notification } from "../domain/notification";
import { ConfigError } from "../errors";
import type { ClientCredentials } from "../http/transport";
import { captureFetch, jsonResponse, TEST_USER_AGENT } from "../testing/fetch-capture";

import { assertCardAlert, mergeAlertUpdate } from "./notification";

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

const SEND_HEADERS = {
  accept: "*/*",
  "user-agent": TEST_USER_AGENT,
  "x-api-key": "mb_wire_test_key",
};

const STORED = Notification.parse({
  id: 9,
  payload_type: "notification/card",
  payload_id: 4,
  payload: { id: 4, card_id: 94, send_condition: "has_result", send_once: false },
  active: true,
  creator_id: 2,
  subscriptions: [
    { id: 9, type: "notification-subscription/cron", cron_schedule: "0 0 8 * * ? *" },
  ],
  handlers: [
    {
      id: 9,
      channel_type: "channel/email",
      recipients: [
        { id: 10, type: "notification-recipient/raw-value", details: { value: "a@example.com" } },
      ],
    },
  ],
});

function clientOver(responses: Array<Response>) {
  const capture = captureFetch(responses);
  const mb = createClient(CREDENTIALS, {
    userAgent: TEST_USER_AGENT,
    fetchImpl: capture.fetch,
  });
  return { mb, capture };
}

describe("notification resource wire requests", () => {
  it("scopes the listing to the card payload type", async () => {
    const { mb, capture } = clientOver([jsonResponse([])]);

    await mb.notification.list();

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/notification?payload_type=notification%2Fcard",
        method: "GET",
        headers: READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("sends every list filter the caller supplies alongside the payload type", async () => {
    const { mb, capture } = clientOver([jsonResponse([])]);

    await mb.notification.list({
      card_id: 94,
      creator_id: 2,
      recipient_id: 3,
      include_inactive: true,
    });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/notification?payload_type=notification%2Fcard&card_id=94&creator_id=2&recipient_id=3&include_inactive=true",
        method: "GET",
        headers: READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("sends the get request", async () => {
    const { mb, capture } = clientOver([jsonResponse(STORED)]);

    await mb.notification.get(9);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/notification/9",
        method: "GET",
        headers: READ_HEADERS,
        body: null,
      },
    ]);
  });

  it("sends the create request with the body as JSON", async () => {
    const { mb, capture } = clientOver([jsonResponse(STORED)]);

    await mb.notification.create({
      payload_type: "notification/card",
      payload: { card_id: 94 },
      subscriptions: [{ type: "notification-subscription/cron", cron_schedule: "0 0 8 * * ? *" }],
      handlers: [{ channel_type: "channel/email" }],
    });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/notification",
        method: "POST",
        headers: JSON_REQUEST_HEADERS,
        body: '{"payload_type":"notification/card","payload":{"card_id":94},"subscriptions":[{"type":"notification-subscription/cron","cron_schedule":"0 0 8 * * ? *"}],"handlers":[{"channel_type":"channel/email"}]}',
      },
    ]);
  });

  it("reads the stored alert before PUTting the merged body", async () => {
    const { mb, capture } = clientOver([
      jsonResponse(STORED),
      jsonResponse({ ...STORED, active: false }),
    ]);

    await mb.notification.update(9, { active: false });

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/notification/9",
        method: "GET",
        headers: READ_HEADERS,
        body: null,
      },
      {
        url: "https://mb.example.com/metabase/api/notification/9",
        method: "PUT",
        headers: JSON_REQUEST_HEADERS,
        body: JSON.stringify({ ...STORED, active: false }),
      },
    ]);
  });

  it("archives by deactivating the alert", async () => {
    const { mb, capture } = clientOver([
      jsonResponse(STORED),
      jsonResponse({ ...STORED, active: false }),
    ]);

    await mb.notification.archive(9);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/notification/9",
        method: "GET",
        headers: READ_HEADERS,
        body: null,
      },
      {
        url: "https://mb.example.com/metabase/api/notification/9",
        method: "PUT",
        headers: JSON_REQUEST_HEADERS,
        body: JSON.stringify({ ...STORED, active: false }),
      },
    ]);
  });

  it("checks the alert is a card alert before sending it off-schedule", async () => {
    const { mb, capture } = clientOver([jsonResponse(STORED), new Response(null, { status: 204 })]);

    await mb.notification.send(9);

    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/notification/9",
        method: "GET",
        headers: READ_HEADERS,
        body: null,
      },
      {
        url: "https://mb.example.com/metabase/api/notification/9/send",
        method: "POST",
        headers: SEND_HEADERS,
        body: null,
      },
    ]);
  });

  it("refuses to send a system-event notification, and never reaches the send endpoint", async () => {
    const systemEvent = { ...STORED, payload_type: "notification/system-event", payload: null };
    const { mb, capture } = clientOver([jsonResponse(systemEvent)]);

    await expect(mb.notification.send(9)).rejects.toThrow(
      new ConfigError(
        "notification 9 is a notification/system-event, not a question alert — this operation accepts card alerts only",
      ),
    );
    expect(capture.calls).toEqual([
      {
        url: "https://mb.example.com/metabase/api/notification/9",
        method: "GET",
        headers: READ_HEADERS,
        body: null,
      },
    ]);
  });
});

describe("assertCardAlert", () => {
  it("returns a card notification unchanged", () => {
    expect(assertCardAlert(STORED)).toEqual(STORED);
  });

  it("rejects a system-event notification, which shares the /api/notification id space", () => {
    const systemEvent = Notification.parse({
      ...STORED,
      id: 1,
      payload_type: "notification/system-event",
      payload_id: null,
      payload: null,
    });

    expect(() => assertCardAlert(systemEvent)).toThrow(
      new ConfigError(
        "notification 1 is a notification/system-event, not a question alert — this operation accepts card alerts only",
      ),
    );
  });
});

describe("mergeAlertUpdate", () => {
  it("keeps the notification id and payload id so the server updates in place", () => {
    const merged = mergeAlertUpdate(STORED, { active: false });

    expect(merged).toEqual({ ...STORED, active: false });
  });

  it("merges a partial payload over the stored one, preserving card_id and the payload id", () => {
    const merged = mergeAlertUpdate(STORED, { payload: { send_condition: "goal_above" } });

    expect(merged).toEqual({
      ...STORED,
      payload: { id: 4, card_id: 94, send_condition: "goal_above", send_once: false },
    });
  });

  it("replaces subscriptions and handlers wholesale, matching the server's spec-diff semantics", () => {
    const merged = mergeAlertUpdate(STORED, {
      subscriptions: [{ type: "notification-subscription/cron", cron_schedule: "0 0 9 * * ? *" }],
      handlers: [
        {
          channel_type: "channel/slack",
          recipients: [
            { type: "notification-recipient/raw-value", details: { value: "#general" } },
          ],
        },
      ],
    });

    expect(merged).toEqual({
      ...STORED,
      subscriptions: [{ type: "notification-subscription/cron", cron_schedule: "0 0 9 * * ? *" }],
      handlers: [
        {
          channel_type: "channel/slack",
          recipients: [
            { type: "notification-recipient/raw-value", details: { value: "#general" } },
          ],
        },
      ],
    });
  });

  it("refuses to patch the payload of an alert whose card payload was deleted server-side", () => {
    const orphaned = Notification.parse({ ...STORED, payload_id: null, payload: null });

    expect(() => mergeAlertUpdate(orphaned, { payload: { send_once: true } })).toThrow(
      new ConfigError("alert 9 has lost its card payload — it can be archived, but not patched"),
    );
  });

  it("still deactivates an alert whose card payload was deleted server-side", () => {
    const orphaned = Notification.parse({ ...STORED, payload_id: null, payload: null });

    expect(mergeAlertUpdate(orphaned, { active: false })).toEqual({
      ...orphaned,
      active: false,
    });
  });
});
