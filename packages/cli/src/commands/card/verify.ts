import { ModerationReview } from "@metabase/client/domain/moderation-review";
import { describeReview, moderationReviewView } from "../../output/views/moderation-review";
import { renderSummary } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";
import { reviewInput, verifyFlags } from "../verify-flags";

export default defineMetabaseCommand({
  meta: { name: "verify", description: "Mark a card verified, or withdraw the mark with --remove" },
  details:
    "Records a moderation review on the card (admins only). Verified content carries a check mark in the product and ranks higher in search. Each call adds a review and makes it the card's most recent one; `--remove` records a review with no status, which withdraws the verification, as does changing the card's query. `--text` stores a note with the review. `card get <id> --fields moderation_reviews` reads the reviews, newest first. Prints the review.",
  requires: ["moderationReview.create"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...verifyFlags,
    id: { type: "positional", description: "Card id", required: true },
  },
  outputSchema: ModerationReview,
  examples: [
    "mb card verify 1",
    'mb card verify 1 --text "Reviewed the joins" --json',
    "mb card verify 1 --remove",
  ],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const client = await getClient();
    const review = await client.moderationReview.create(reviewInput("card", id, args));
    renderSummary(review, moderationReviewView, describeReview(review), ctx);
  },
});
