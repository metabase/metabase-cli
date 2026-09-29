import { describe, expect, it } from "vitest";

import { reviewInput } from "./verify-flags";

describe("reviewInput", () => {
  it("grants verification when --remove is absent", () => {
    expect(reviewInput("card", 12, { text: "Reviewed the joins", remove: false })).toEqual({
      moderated_item_id: 12,
      moderated_item_type: "card",
      status: "verified",
      text: "Reviewed the joins",
    });
  });

  it("withdraws verification with a null status under --remove", () => {
    expect(reviewInput("dashboard", 7, { text: undefined, remove: true })).toEqual({
      moderated_item_id: 7,
      moderated_item_type: "dashboard",
      status: null,
    });
  });
});
