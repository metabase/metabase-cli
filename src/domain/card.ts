import { z } from "zod";

import type { ResourceView } from "./view";

const CardType = z.enum(["question", "model", "metric"]);

const CardQueryType = z.enum(["native", "query"]);

export const Card = z
  .object({
    id: z.number().int(),
    name: z.string(),
    type: CardType,
    display: z.string(),
    description: z.string().nullable(),
    archived: z.boolean(),
    query_type: CardQueryType.nullable(),
    database_id: z.number().int().nullable(),
    table_id: z.number().int().nullable(),
    collection_id: z.number().int().nullable(),
    dashboard_id: z.number().int().nullable().optional(),
    entity_id: z.string().nullable(),
    creator_id: z.number().int(),
    dataset_query: z.unknown(),
    visualization_settings: z.unknown(),
  })
  .loose();
export type Card = z.infer<typeof Card>;

export const CardCompact = Card.pick({
  id: true,
  name: true,
  type: true,
  display: true,
  archived: true,
  database_id: true,
  collection_id: true,
  description: true,
}).strip();
export type CardCompact = z.infer<typeof CardCompact>;

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

export const CardCreateInput = z
  .object({
    name: z.string().min(1),
    type: CardType.optional(),
    dataset_query: z.unknown(),
    display: z.string().min(1),
    visualization_settings: z.unknown(),
    description: z.string().nullable().optional(),
    collection_id: z.number().int().positive().nullable().optional(),
    collection_position: z.number().int().positive().nullable().optional(),
    dashboard_id: z.number().int().positive().nullable().optional(),
    parameters: z.array(z.unknown()).optional(),
    parameter_mappings: z.array(z.unknown()).optional(),
  })
  .loose();
export type CardCreateInput = z.infer<typeof CardCreateInput>;

export const CardUpdateInput = z
  .object({
    name: z.string().min(1).optional(),
    type: CardType.optional(),
    dataset_query: z.unknown().optional(),
    display: z.string().min(1).optional(),
    visualization_settings: z.unknown().optional(),
    description: z.string().nullable().optional(),
    archived: z.boolean().optional(),
    enable_embedding: z.boolean().optional(),
    embedding_type: z.string().optional(),
    embedding_params: z.unknown().optional(),
    collection_id: z.number().int().positive().nullable().optional(),
    collection_position: z.number().int().positive().nullable().optional(),
    collection_preview: z.boolean().optional(),
    cache_ttl: z.number().int().positive().nullable().optional(),
    dashboard_id: z.number().int().positive().nullable().optional(),
    dashboard_tab_id: z.number().int().positive().nullable().optional(),
    parameters: z.array(z.unknown()).optional(),
    parameter_mappings: z.array(z.unknown()).optional(),
    result_metadata: z.array(z.unknown()).nullable().optional(),
  })
  .loose();
export type CardUpdateInput = z.infer<typeof CardUpdateInput>;

const QueryColumn = z
  .object({
    name: z.string(),
    display_name: z.string().optional(),
    base_type: z.string().optional(),
    semantic_type: z.string().nullable().optional(),
  })
  .loose();

const CardQueryDataCompleted = z
  .object({
    rows: z.array(z.unknown()),
    cols: z.array(QueryColumn),
  })
  .loose();

const CardQueryCompleted = z
  .object({
    status: z.literal("completed"),
    row_count: z.number().int().nonnegative(),
    data: CardQueryDataCompleted,
  })
  .loose();

const CardQueryFailed = z
  .object({
    status: z.literal("failed"),
    error: z.string().nullable().optional(),
    error_type: z.string().nullable().optional(),
  })
  .loose();

export const CardQueryResult = z.discriminatedUnion("status", [
  CardQueryCompleted,
  CardQueryFailed,
]);
export type CardQueryResult = z.infer<typeof CardQueryResult>;

export const cardQueryView: ResourceView<CardQueryResult> = {
  compactPick: CardQueryResult,
  tableColumns: [{ key: "status", label: "Status" }],
};
