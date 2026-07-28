import {
  type Dashboard,
  DashboardCompact,
  type Dashcard,
  DashcardCompact,
} from "@metabase/client/domain/dashboard";

import type { ResourceView } from "../view";

export const dashcardView: ResourceView<Dashcard> = {
  compactPick: DashcardCompact,
  tableColumns: [
    { key: "id", label: "ID" },
    { key: "card_id", label: "Card" },
    { key: "dashboard_tab_id", label: "Tab" },
    { key: "row", label: "Row" },
    { key: "col", label: "Col" },
    { key: "size_x", label: "W" },
    { key: "size_y", label: "H" },
  ],
};

export const dashboardView: ResourceView<Dashboard> = {
  compactPick: DashboardCompact,
  tableColumns: [
    { key: "id", label: "ID" },
    { key: "name", label: "Name" },
    { key: "collection_id", label: "Collection" },
    { key: "archived", label: "Archived" },
  ],
};
