import { ModerationReview, type ModerationReviewCreateInput } from "../domain/moderation-review";
import type { RequestOptions, Transport } from "../http/transport";

export function moderationReviewResource(transport: Transport) {
  /**
   * Create a moderation review on a card or dashboard. `status: "verified"` marks the item
   * verified, `null` or an absent status records a note that leaves it unverified. The new review
   * becomes the item's most recent one; the server keeps the ten newest per item. Admins only.
   */
  async function create(
    params: ModerationReviewCreateInput,
    options: RequestOptions = {},
  ): Promise<ModerationReview> {
    await transport.require("moderationReview.create", options);
    return transport.requestParsed(ModerationReview, "/api/moderation-review", {
      ...options,
      method: "POST",
      body: params,
    });
  }

  return { create };
}
