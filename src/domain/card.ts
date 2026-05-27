import { z } from "zod";

import { FieldBaseType, FieldSemanticType } from "./field";
import type { ResourceView } from "./view";

const CardType = z.enum(["question", "model", "metric"]);

const CardQueryType = z.enum(["native", "query"]);

// `dataset_query: {}` is accepted by the server's `::query` schema for historic
// reasons but immediately trips the NOT NULL constraint on REPORT_CARD.DATABASE_ID
// during INSERT, surfacing as a raw H2 stack trace. `dataset_query: null` is
// rejected by the create endpoint with a generic 400. Both are unrecoverable —
// reject at the CLI boundary so the agent gets a readable error.
export const CardDatasetQuery = z
  .object({})
  .loose()
  .refine((value) => "lib/type" in value || "type" in value, {
    message:
      'dataset_query must include "lib/type" (MBQL 5) or "type" (legacy MBQL/native); empty `{}` is rejected',
  });
export type CardDatasetQuery = z.infer<typeof CardDatasetQuery>;

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
    dataset_query: CardDatasetQuery,
    display: z.string().min(1),
    visualization_settings: z.record(z.string(), z.unknown()),
    description: z.string().min(1).nullable().optional(),
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
    dataset_query: CardDatasetQuery.optional(),
    display: z.string().min(1).optional(),
    visualization_settings: z.record(z.string(), z.unknown()).optional(),
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
    base_type: FieldBaseType.optional(),
    semantic_type: FieldSemanticType.nullable().optional(),
  })
  .loose();

const CardQueryData = z
  .object({
    rows: z.array(z.unknown()),
    cols: z.array(QueryColumn),
  })
  .loose();

export const CardQueryResult = z
  .object({
    status: z.string(),
    row_count: z.number().int().nonnegative().optional(),
    data: CardQueryData.optional(),
    error: z.string().nullable().optional(),
    error_type: z.string().nullable().optional(),
  })
  .loose();
export type CardQueryResult = z.infer<typeof CardQueryResult>;

// The raw `/api/dataset` envelope carries heavy per-column `lib/*` metadata, fingerprints,
// `results_metadata`, and `native_form`. The compact projection keeps only what an agent
// reading rows needs — status, row_count, the rows, and a slim column header — so the default
// `--json` output isn't hundreds of lines of metadata. `--full` returns the raw envelope.
const QueryColumnCompact = QueryColumn.pick({
  name: true,
  display_name: true,
  base_type: true,
  semantic_type: true,
}).strip();

const CardQueryDataCompact = z
  .object({
    rows: z.array(z.unknown()),
    cols: z.array(QueryColumnCompact),
  })
  .strip();

export const CardQueryResultCompact = CardQueryResult.pick({
  status: true,
  row_count: true,
  error: true,
  error_type: true,
})
  .strip()
  .extend({ data: CardQueryDataCompact.optional() });
export type CardQueryResultCompact = z.infer<typeof CardQueryResultCompact>;

export const cardQueryView: ResourceView<CardQueryResult> = {
  compactPick: CardQueryResultCompact,
  tableColumns: [{ key: "status", label: "Status" }],
};
