import { z } from "zod";

import { Collection } from "./collection";
import type { ResourceView } from "./view";

export const LibraryChild = Collection.pick({
  id: true,
  name: true,
  type: true,
  description: true,
  is_remote_synced: true,
}).strip();
export type LibraryChild = z.infer<typeof LibraryChild>;

export const Library = Collection.extend({
  effective_children: z.array(LibraryChild),
}).loose();
export type Library = z.infer<typeof Library>;

export const LibraryCompact = Library.pick({
  id: true,
  name: true,
  type: true,
  effective_children: true,
}).strip();
export type LibraryCompact = z.infer<typeof LibraryCompact>;

export const libraryView: ResourceView<Library> = {
  compactPick: LibraryCompact,
  tableColumns: [
    { key: "id", label: "ID" },
    { key: "name", label: "Name" },
    { key: "type", label: "Type" },
  ],
};
