import { z } from "zod";

import type { ResourceView } from "./view";

export const CurrentUser = z
  .object({
    id: z.number().int(),
    email: z.email(),
    common_name: z.string(),
    is_superuser: z.boolean(),
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

export const userView: ResourceView<CurrentUser> = {
  compactPick: CurrentUserCompact,
  tableColumns: [
    { key: "id", label: "ID" },
    { key: "email", label: "Email" },
    { key: "common_name", label: "Name" },
    { key: "is_superuser", label: "Admin" },
  ],
};
