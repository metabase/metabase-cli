import { describe, expect, it } from "vitest";

import type { Pulse } from "@metabase/client/domain/pulse";

import { MALFORMED_CELL } from "../table";
import { pulseView } from "./pulse";

function renderCell(key: keyof Pulse & string, value: unknown): string {
  const column = pulseView.tableColumns.find((candidate) => candidate.key === key);
  if (column?.format === undefined) {
    throw new Error(`pulseView declares no formatter for "${key}"`);
  }
  return column.format(value);
}

describe("pulseView delivery cell", () => {
  it("renders a channel as its type, schedule, and audience", () => {
    expect(
      renderCell("channels", [
        {
          channel_type: "email",
          enabled: true,
          schedule_type: "weekly",
          schedule_hour: 8,
          schedule_day: "mon",
          schedule_frame: null,
          recipients: [{ id: 3, email: "ops@example.com" }],
        },
      ]),
    ).toBe("email weekly mon 8:00 → ops@example.com");
  });

  // A channel type this Metabase delivers to and the CLI does not know fails the enum. Blanking
  // the cell would read as "this subscription delivers nowhere".
  it("renders a channel list that fails its schema as the malformed marker", () => {
    expect(
      renderCell("channels", [
        {
          channel_type: "teams",
          enabled: true,
          schedule_type: "daily",
          schedule_hour: 8,
          schedule_day: null,
          schedule_frame: null,
          recipients: [],
        },
      ]),
    ).toBe(MALFORMED_CELL);
  });
});
