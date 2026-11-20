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
    "Adds a moderation review that marks the card verified (admins only). Verified content shows a check mark and ranks higher in search, and `mb search --verified` finds only verified content. `--remove` adds a review with no status, which withdraws the mark, and so does a change to the card's query. Prints the review, whose `status` is `verified` or `null`; `card get <id> --fields moderation_reviews` lists every review, newest first.",
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
