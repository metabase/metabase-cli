import {
  type Card,
  CardCompact,
  type CardQueryResult,
  CardQueryResultCompact,
} from "@metabase/client/domain/card";

import type { ResourceView } from "../view";

export const cardView: ResourceView<Card> = {
  compactPick: CardCompact,
  tableColumns: [
    { key: "id", label: "ID" },
    { key: "name", label: "Name" },
    { key: "type", label: "Type" },
    { key: "display", label: "Display" },
    { key: "database_id", label: "DB" },
    { key: "collection_id", label: "Collection" },
    { key: "archived", label: "Archived" },
  ],
};

export const cardQueryView: ResourceView<CardQueryResult> = {
  compactPick: CardQueryResultCompact,
  tableColumns: [{ key: "status", label: "Status" }],
};
