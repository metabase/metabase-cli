import { DataAppCompact, DataAppPermissionWarning } from "@metabase/client/domain/data-app";

import type { ResourceView } from "../view";

export const dataAppView: ResourceView<DataAppCompact> = {
  compactPick: DataAppCompact,
  tableColumns: [
    { key: "name", label: "Slug" },
    { key: "display_name", label: "Name" },
    { key: "enabled", label: "Enabled" },
    { key: "version", label: "Version" },
    { key: "outdated", label: "Outdated" },
  ],
};

export const dataAppPermissionWarningView: ResourceView<DataAppPermissionWarning> = {
  compactPick: DataAppPermissionWarning,
  tableColumns: [{ key: "user_id", label: "User" }],
};
