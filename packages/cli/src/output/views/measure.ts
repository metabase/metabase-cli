import { type Measure, MeasureCompact } from "@metabase/client/domain/measure";

import type { ResourceView } from "../view";

export const measureView: ResourceView<Measure> = {
  compactPick: MeasureCompact,
  tableColumns: [
    { key: "id", label: "ID" },
    { key: "name", label: "Name" },
    { key: "description", label: "Description" },
    { key: "table_id", label: "Table" },
    { key: "archived", label: "Archived" },
  ],
};
