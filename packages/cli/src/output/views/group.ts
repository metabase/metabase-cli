import { type Group, GroupCompact } from "@metabase/client/domain/group";

import type { ResourceView } from "../view";

export const groupView: ResourceView<Group> = {
  compactPick: GroupCompact,
  tableColumns: [
    { key: "id", label: "ID" },
    { key: "name", label: "Name" },
    { key: "member_count", label: "Members" },
  ],
};
