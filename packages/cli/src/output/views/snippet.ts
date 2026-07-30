import { type Snippet, SnippetCompact } from "@metabase/client/domain/snippet";

import type { ResourceView } from "../view";

export const snippetView: ResourceView<Snippet> = {
  compactPick: SnippetCompact,
  tableColumns: [
    { key: "id", label: "ID" },
    { key: "name", label: "Name" },
    { key: "description", label: "Description" },
    { key: "collection_id", label: "Collection" },
    { key: "archived", label: "Archived" },
  ],
};
