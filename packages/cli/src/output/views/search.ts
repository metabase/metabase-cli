import { type SearchResult, SearchResultCompact } from "@metabase/client/domain/search";

import type { ResourceView } from "../view";

export const searchResultView: ResourceView<SearchResult> = {
  compactPick: SearchResultCompact,
  tableColumns: [
    { key: "id", label: "ID" },
    { key: "model", label: "Model" },
    { key: "name", label: "Name" },
  ],
};
