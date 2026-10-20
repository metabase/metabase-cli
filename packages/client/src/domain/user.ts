import { z } from "zod";

export const CurrentUser = z
  .object({
    id: z.number().int(),
    email: z.email(),
    common_name: z.string(),
    is_superuser: z.boolean(),
    personal_collection_id: z.number().int().nullable().optional(),
  })
  .loose();
export type CurrentUser = z.infer<typeof CurrentUser>;

export const CurrentUserCompact = CurrentUser.pick({
  id: true,
  email: true,
  common_name: true,
  is_superuser: true,
}).strip();
export type CurrentUserCompact = z.infer<typeof CurrentUserCompact>;
