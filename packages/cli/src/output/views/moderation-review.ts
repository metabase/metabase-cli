import {
  type ModerationReview,
  ModerationReviewCompact,
} from "@metabase/client/domain/moderation-review";

import type { ResourceView } from "../view";

export const moderationReviewView: ResourceView<ModerationReview> = {
  compactPick: ModerationReviewCompact,
  tableColumns: [
    { key: "id", label: "ID" },
    { key: "moderated_item_type", label: "Item type" },
    { key: "moderated_item_id", label: "Item ID" },
    { key: "status", label: "Status" },
    { key: "text", label: "Text" },
    { key: "most_recent", label: "Most recent" },
  ],
};

export function describeReview(review: ModerationReview): string {
  const target = `${review.moderated_item_type} ${review.moderated_item_id}`;
  if (review.status === null) {
    return `Marked ${target} unverified.`;
  }
  return `Verified ${target}.`;
}
