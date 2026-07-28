import { type Library, LibraryCompact } from "@metabase/client/domain/library";

import type { ResourceView } from "../view";

export const libraryView: ResourceView<Library> = {
  compactPick: LibraryCompact,
  tableColumns: [
    { key: "id", label: "ID" },
    { key: "name", label: "Name" },
    { key: "type", label: "Type" },
  ],
};
