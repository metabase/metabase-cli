import { describe, expect, it } from "vitest";

import { ConfigError } from "../../core/errors";
import { Notification } from "../../domain/notification";

import { assertCardAlert, mergeAlertUpdate } from "./patch";

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
        "notification 1 is a notification/system-event, not a question alert — `mb alert` manages card alerts only",
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
