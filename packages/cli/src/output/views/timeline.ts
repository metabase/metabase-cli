import {
  type Timeline,
  TimelineCompact,
  type TimelineEvent,
  TimelineEventCompact,
} from "@metabase/client/domain/timeline";

import type { ResourceView } from "../view";

export const timelineEventView: ResourceView<TimelineEvent> = {
  compactPick: TimelineEventCompact,
  tableColumns: [
    { key: "id", label: "ID" },
    { key: "name", label: "Name" },
    { key: "timestamp", label: "Timestamp" },
    { key: "icon", label: "Icon" },
    { key: "timeline_id", label: "Timeline" },
    { key: "archived", label: "Archived" },
  ],
};

export const timelineView: ResourceView<Timeline> = {
  compactPick: TimelineCompact,
  tableColumns: [
    { key: "id", label: "ID" },
    { key: "name", label: "Name" },
    { key: "description", label: "Description" },
    { key: "icon", label: "Icon" },
    { key: "collection_id", label: "Collection" },
    { key: "default", label: "Default" },
    { key: "archived", label: "Archived" },
  ],
};
