import { describe, expect, it } from "vitest";

import { Pulse, type PulseUpdateInput } from "../../domain/pulse";

import { mergeSubscriptionUpdate } from "./patch";

const STORED = Pulse.parse({
  id: 1,
  name: "Weekly orders",
  creator_id: 2,
  dashboard_id: 10,
  collection_id: 4,
  archived: true,
  skip_if_empty: true,
  parameters: [],
  cards: [
    {
      id: 94,
      name: "Orders by status",
      dashboard_card_id: 87,
      include_csv: false,
      include_xls: false,
    },
  ],
  channels: [
    {
      channel_type: "email",
      enabled: false,
      schedule_type: "daily",
      schedule_hour: 8,
      schedule_day: null,
      schedule_frame: null,
      recipients: [{ email: "team@example.com" }],
    },
  ],
});

describe("mergeSubscriptionUpdate", () => {
  it("carries archived and skip_if_empty forward, which the server would otherwise default to false", () => {
    expect(mergeSubscriptionUpdate(STORED, { name: "Daily orders" })).toEqual({
      name: "Daily orders",
      archived: true,
      skip_if_empty: true,
    });
  });

  it("lets the caller override both of the server-defaulted fields", () => {
    expect(mergeSubscriptionUpdate(STORED, { archived: false, skip_if_empty: false })).toEqual({
      archived: false,
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

    expect(mergeSubscriptionUpdate(STORED, { channels })).toEqual({
      channels,
      archived: true,
      skip_if_empty: true,
    });
  });
});
