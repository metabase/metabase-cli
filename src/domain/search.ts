import { z } from "zod";

import type { ResourceView } from "./view";

export const SEARCH_MODELS = [
  "card",
  "dataset",
  "metric",
  "dashboard",
  "collection",
  "database",
  "table",
  "segment",
  "measure",
  "snippet",
  "document",
  "action",
  "transform",
  "indexed-entity",
] as const;

export const SearchModel = z.enum(SEARCH_MODELS);
export type SearchModel = z.infer<typeof SearchModel>;

const SearchResultCollection = z
  .object({
    id: z.union([z.number().int(), z.string(), z.null()]),
    name: z.string().nullable(),
    authority_level: z.string().nullable(),
    type: z.string().nullable(),
  })
  .loose();

export const SearchResult = z
  .object({
    id: z.union([z.number().int(), z.string()]),
    name: z.string(),
    model: SearchModel,
    description: z.string().nullable(),
    archived: z.boolean().nullable(),
    collection: SearchResultCollection.nullable(),
  })
  .loose();
export type SearchResult = z.infer<typeof SearchResult>;

export const SearchResultCompact = SearchResult.pick({
  id: true,
  name: true,
  model: true,
  description: true,
  archived: true,
}).strip();
export type SearchResultCompact = z.infer<typeof SearchResultCompact>;

export const searchResultView: ResourceView<SearchResult> = {
  compactPick: SearchResultCompact,
  tableColumns: [
    { key: "id", label: "ID" },
    { key: "model", label: "Model" },
    { key: "name", label: "Name" },
    { key: "archived", label: "Archived" },
  ],
};
