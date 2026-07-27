import { type Document, DocumentCompact } from "@metabase/client/domain/document";

import type { ResourceView } from "../view";

export const documentView: ResourceView<Document> = {
  compactPick: DocumentCompact,
  tableColumns: [
    { key: "id", label: "ID" },
    { key: "name", label: "Name" },
    { key: "collection_id", label: "Collection" },
    { key: "creator_id", label: "Creator" },
    { key: "archived", label: "Archived" },
  ],
};
