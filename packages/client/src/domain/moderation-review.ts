import { z } from "zod";

export const ModeratedItemType = z.enum(["card", "dashboard"]);
export type ModeratedItemType = z.infer<typeof ModeratedItemType>;

export const ModerationStatus = z.enum(["verified"]);
export type ModerationStatus = z.infer<typeof ModerationStatus>;

export const ModerationReview = z
  .object({
    id: z.number().int(),
    moderated_item_id: z.number().int(),
    moderated_item_type: ModeratedItemType,
    moderator_id: z.number().int(),
    status: ModerationStatus.nullable(),
    text: z.string().nullable(),
    most_recent: z.boolean(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .loose();
export type ModerationReview = z.infer<typeof ModerationReview>;

export const ModerationReviewCompact = ModerationReview.pick({
  id: true,
  moderated_item_id: true,
  moderated_item_type: true,
  status: true,
  text: true,
  most_recent: true,
}).strip();
export type ModerationReviewCompact = z.infer<typeof ModerationReviewCompact>;

// The server closes the body map, so a key beyond these four is a 400 there; refuse it here instead.
export const ModerationReviewCreateInput = z
  .object({
    moderated_item_id: z.number().int().positive(),
    moderated_item_type: ModeratedItemType,
    status: ModerationStatus.nullable().optional(),
    text: z.string().nullable().optional(),
  })
  .strict();
export type ModerationReviewCreateInput = z.infer<typeof ModerationReviewCreateInput>;
