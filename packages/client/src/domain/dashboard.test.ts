import { assert, describe, expect, it } from "vitest";

import { DashboardUpdateInput } from "./dashboard";

describe("DashboardUpdateInput", () => {
  it("rejects a dashcard whose card_id is omitted", () => {
    const result = DashboardUpdateInput.safeParse({
      dashcards: [{ id: 17, row: 0, col: 0, size_x: 12, size_y: 6 }],
    });

    assert(!result.success, "expected the dashboard update to be rejected");
    expect(result.error.issues.map(({ code, path, message }) => ({ code, path, message }))).toEqual(
      [
        {
          code: "invalid_type",
          path: ["dashcards", 0, "card_id"],
          message: "Invalid input: expected number, received undefined",
        },
      ],
    );
  });
});
