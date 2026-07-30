import {
  type Collection,
  CollectionCompact,
  type CollectionItem,
  CollectionItemCompact,
} from "@metabase/client/domain/collection";

import type { ResourceView } from "../view";

export const collectionView: ResourceView<Collection> = {
  compactPick: CollectionCompact,
  tableColumns: [
    { key: "id", label: "ID" },
    { key: "name", label: "Name" },
    { key: "location", label: "Location" },
    { key: "type", label: "Type" },
    { key: "authority_level", label: "Authority" },
    { key: "archived", label: "Archived" },
  ],
};

export const collectionItemView: ResourceView<CollectionItem> = {
  compactPick: CollectionItemCompact,
  tableColumns: [
    { key: "id", label: "ID" },
    { key: "model", label: "Model" },
    { key: "name", label: "Name" },
    { key: "collection_id", label: "Collection" },
    { key: "archived", label: "Archived" },
  ],
};
