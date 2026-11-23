import {
  type PermissionGroup,
  PermissionGroupCompact,
  type SavedPermissionGroup,
  SavedPermissionGroupCompact,
} from "@metabase/client/domain/permission";

import type { ResourceView } from "../view";

export const permissionGroupView: ResourceView<PermissionGroup> = {
  compactPick: PermissionGroupCompact,
  tableColumns: [
    { key: "id", label: "ID" },
    { key: "name", label: "Name" },
    { key: "magic_group_type", label: "Built-in" },
    { key: "member_count", label: "Members" },
  ],
};

export const savedPermissionGroupView: ResourceView<SavedPermissionGroup> = {
  compactPick: SavedPermissionGroupCompact,
  tableColumns: [
    { key: "id", label: "ID" },
    { key: "name", label: "Name" },
    { key: "magic_group_type", label: "Built-in" },
  ],
};
