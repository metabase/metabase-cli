import { ModerationReview } from "@metabase/client/domain/moderation-review";
import { describeReview, moderationReviewView } from "../../output/views/moderation-review";
import { renderSummary } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";
import { reviewInput, verifyFlags } from "../verify-flags";

export default defineMetabaseCommand({
  meta: {
    name: "verify",
    description: "Mark a dashboard verified, or withdraw the mark with --remove",
  },
  details:
    "Records a moderation review on the dashboard (admins only). Verified content carries a check mark in the product and ranks higher in search; `mb search --verified` finds only verified content. Each call adds a review and makes it the dashboard's most recent one; `--remove` records a review with no status, which withdraws the verification. `dashboard get <id> --fields moderation_reviews` reads the reviews, newest first; the first one's `status` is the current state. Prints the review, whose `status` is `verified` or `null`; `--full` adds `moderator_id` and the timestamps.",
  requires: ["moderationReview.create"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...verifyFlags,
    id: { type: "positional", description: "Dashboard id", required: true },
  },
  outputSchema: ModerationReview,
  examples: [
    "mb dashboard verify 1",
    'mb dashboard verify 1 --text "Reviewed the joins" --json',
    "mb dashboard verify 1 --remove",
  ],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const client = await getClient();
    const review = await client.moderationReview.create(reviewInput("dashboard", id, args));
    renderSummary(review, moderationReviewView, describeReview(review), ctx);
  },
});
