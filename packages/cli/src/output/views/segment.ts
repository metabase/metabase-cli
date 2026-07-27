import { type Segment, SegmentCompact } from "@metabase/client/domain/segment";

import type { ResourceView } from "../view";

export const segmentView: ResourceView<Segment> = {
  compactPick: SegmentCompact,
  tableColumns: [
    { key: "id", label: "ID" },
    { key: "name", label: "Name" },
    { key: "description", label: "Description" },
    { key: "table_id", label: "Table" },
    { key: "archived", label: "Archived" },
  ],
};
