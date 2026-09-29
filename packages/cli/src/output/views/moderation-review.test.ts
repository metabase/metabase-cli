import { describe, expect, it } from "vitest";

import type { ModerationReview } from "@metabase/client/domain/moderation-review";

import { describeReview } from "./moderation-review";

const REVIEW: ModerationReview = {
  id: 3,
  moderated_item_id: 12,
  moderated_item_type: "card",
  moderator_id: 1,
  status: "verified",
  text: null,
  most_recent: true,
  created_at: "2026-09-20T15:00:00Z",
  updated_at: "2026-09-20T15:00:00Z",
};

describe("describeReview", () => {
  it("names the verified item", () => {
    expect(describeReview(REVIEW)).toBe("Verified card 12.");
  });

  it("names a withdrawal when the review carries no status", () => {
    expect(describeReview({ ...REVIEW, status: null, moderated_item_type: "dashboard" })).toBe(
      "Marked dashboard 12 unverified.",
    );
  });
});
