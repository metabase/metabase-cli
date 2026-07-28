import { describe, expect, it } from "vitest";

import type { Notification } from "@metabase/client/domain/notification";

import { MALFORMED_CELL } from "../table";
import { notificationView } from "./notification";

function renderCell(key: keyof Notification & string, value: unknown): string {
  const column = notificationView.tableColumns.find((candidate) => candidate.key === key);
  if (column?.format === undefined) {
    throw new Error(`notificationView declares no formatter for "${key}"`);
  }
  return column.format(value);
}

describe("notificationView payload cell", () => {
  it("renders a card payload as its id, send condition, and send-once flag", () => {
    expect(
      renderCell("payload", { card_id: 7, send_condition: "goal_above", send_once: true }),
    ).toBe("7 (goal_above, once)");
  });

  it("renders the null payload of a system-event notification as a blank cell", () => {
    expect(renderCell("payload", null)).toBe("");
  });

  it("renders a payload that fails its schema as the malformed marker", () => {
    expect(
      renderCell("payload", {
        card_id: "seven",
        send_condition: "goal_above",
        send_once: true,
      }),
    ).toBe(MALFORMED_CELL);
  });
});

describe("notificationView subscriptions cell", () => {
  it("renders a subscription list that fails its schema as the malformed marker", () => {
    expect(renderCell("subscriptions", [{ type: "notification-subscription/hourly" }])).toBe(
      MALFORMED_CELL,
    );
  });
});

describe("notificationView handlers cell", () => {
  it("renders a handler list that fails its schema as the malformed marker", () => {
    expect(renderCell("handlers", [{ channel_type: "channel/webhook" }])).toBe(MALFORMED_CELL);
  });
});
