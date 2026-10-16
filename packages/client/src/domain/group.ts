import { z } from "zod";

import { NonBlankText } from "./text";

// A permission group: the id a permissions graph is keyed by, and its name. `member_count`, the
// number of users in it, rides the listing only; a created or renamed group answers without it.
export const Group = z
  .object({
    id: z.number().int(),
    name: z.string(),
    member_count: z.number().int().optional(),
  })
  .loose();
export type Group = z.infer<typeof Group>;

export const GroupCompact = Group.pick({ id: true, name: true, member_count: true }).strip();
export type GroupCompact = z.infer<typeof GroupCompact>;

// The server stores only the name, so refuse any other key rather than let it vanish.
export const GroupCreateInput = z.object({ name: NonBlankText }).strict();
export type GroupCreateInput = z.infer<typeof GroupCreateInput>;

export const GroupUpdateInput = GroupCreateInput;
export type GroupUpdateInput = GroupCreateInput;
