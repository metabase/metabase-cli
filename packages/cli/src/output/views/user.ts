import { type CurrentUser, CurrentUserCompact } from "@metabase/client/domain/user";

import type { ResourceView } from "../view";

export const userView: ResourceView<CurrentUser> = {
  compactPick: CurrentUserCompact,
  tableColumns: [
    { key: "id", label: "ID" },
    { key: "email", label: "Email" },
    { key: "common_name", label: "Name" },
    { key: "is_superuser", label: "Admin" },
  ],
};
