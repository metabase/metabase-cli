import { z } from "zod";

import type { ResourceView } from "./view";

export const CurrentUser = z
  .object({
    id: z.number().int(),
    email: z.email(),
  })
  .loose();
export type CurrentUser = z.infer<typeof CurrentUser>;

export const CurrentUserCompact = CurrentUser.pick({ id: true, email: true });
export type CurrentUserCompact = z.infer<typeof CurrentUserCompact>;

export const userView: ResourceView<CurrentUser> = {
  compactPick: CurrentUserCompact,
  tableColumns: [
    { key: "id", label: "ID" },
    { key: "email", label: "Email" },
  ],
};
