import { ModerationReview, ModerationReviewCreateInput } from "../domain/moderation-review";
import type { RequestOptions, Transport } from "../http/transport";
import { explainer } from "../version/refusal";

import { parseRequestBody } from "./request-body";

export function moderationReviewResource(transport: Transport) {
  const { explain } = explainer(transport, "moderationReview");

  /**
   * Create a moderation review on a card or dashboard. `status: "verified"` marks the item
   * verified, `null` or an absent status records a note that leaves it unverified. The new review
   * becomes the item's most recent one; the server keeps the ten newest per item. Admins only.
   * A body that does not match `ModerationReviewCreateInput` is refused before any request.
   */
  async function create(
    params: ModerationReviewCreateInput,
    options: RequestOptions = {},
  ): Promise<ModerationReview> {
    const body = parseRequestBody(ModerationReviewCreateInput, params, "moderation review");
    return transport.requestParsed(ModerationReview, "/api/moderation-review", {
      ...options,
      method: "POST",
      body,
    });
  }

  return { create: explain("create", create) };
}
