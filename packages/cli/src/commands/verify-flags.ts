import type {
  ModeratedItemType,
  ModerationReviewCreateInput,
} from "@metabase/client/domain/moderation-review";

import type { FlagValues } from "./flag-values";

export const verifyFlags = {
  text: { type: "string", description: "Note stored with the review" },
  remove: { type: "boolean", description: "Withdraw the verification instead of granting it" },
} as const;

export function reviewInput(
  itemType: ModeratedItemType,
  itemId: number,
  args: FlagValues<typeof verifyFlags>,
): ModerationReviewCreateInput {
  return {
    moderated_item_id: itemId,
    moderated_item_type: itemType,
    status: args.remove ? null : "verified",
    text: args.text,
  };
}
