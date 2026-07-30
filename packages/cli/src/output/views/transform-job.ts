import { type TransformJob, TransformJobCompact } from "@metabase/client/domain/transform-job";

import type { ResourceView } from "../view";

export const transformJobView: ResourceView<TransformJob> = {
  compactPick: TransformJobCompact,
  tableColumns: [
    { key: "id", label: "ID" },
    { key: "name", label: "Name" },
    { key: "schedule", label: "Schedule" },
    { key: "ui_display_type", label: "Display" },
    { key: "active", label: "Active" },
    { key: "built_in_type", label: "Built-in" },
    { key: "description", label: "Description" },
  ],
};
