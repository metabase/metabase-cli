import { z } from "zod";

import { EmbeddingParams } from "./embedding";
import { FieldBaseType, FieldSemanticType } from "./field";
import { ModerationReview } from "./moderation-review";
import { Parameter, ParameterMapping } from "./parameter";
import { DatasetQuery } from "./query";

export const CardType = z.enum(["question", "model", "metric"]);
export type CardType = z.infer<typeof CardType>;

const CardQueryType = z.enum(["native", "query"]);

// The server-side presets `GET /api/card`'s `f` parameter accepts. `database`, `table`,
// `using_model` and `using_segment` each need the matching id in `model_id`.
export const CardListFilter = z.enum([
  "all",
  "mine",
  "bookmarked",
  "database",
  "table",
  "archived",
  "using_model",
  "using_segment",
]);
export type CardListFilter = z.infer<typeof CardListFilter>;

// A column of a query's result, as a run returns it in `cols` and a card records it in
// `result_metadata`. A native column has no `id`, and a native card's `result_metadata` no
// `effective_type` or `semantic_type`; a column with no semantic type leaves the key out; a
// remapped column's `id` is null.
export const ResultColumn = z
  .object({
    name: z.string(),
    display_name: z.string().nullable().optional(),
    base_type: FieldBaseType.optional(),
    effective_type: FieldBaseType.nullable().optional(),
    semantic_type: FieldSemanticType.nullable().optional(),
    database_type: z.string().nullable().optional(),
    id: z.number().int().nullable().optional(),
    source: z.string().nullable().optional(),
  })
  .loose();
export type ResultColumn = z.infer<typeof ResultColumn>;

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
    collection_position: z.number().int().nullable(),
    // A card list leaves the reviews out; a single card and a dashboard's cards carry them.
    moderation_reviews: z.array(ModerationReview).optional(),
  })
  .loose();
export type Card = z.infer<typeof Card>;

// A single card read or write, typed down to its parameters and result columns. A list keeps to
// `Card`, so one card whose metadata names an unexpected type fails only its own read.
export const CardDetail = Card.extend({
  // `null` on a card saved before cards had parameters and never saved since, and on one whose
  // stored parameters the server could not normalize.
  parameters: z.array(Parameter).nullable(),
  // `null` until the server has worked out the columns the card's query returns.
  result_metadata: z.array(ResultColumn).nullable(),
});
export type CardDetail = z.infer<typeof CardDetail>;

export const CardCompact = Card.pick({
  id: true,
  name: true,
  type: true,
  display: true,
  archived: true,
  database_id: true,
  collection_id: true,
  dashboard_id: true,
  description: true,
}).strip();
export type CardCompact = z.infer<typeof CardCompact>;

const CollectionIdOrEntityId = z.union([
  z.number().int().positive(),
  z.string().length(21).describe("collection entity_id (21-char NanoID)"),
]);

export const CardCreateInput = z
  .object({
    name: z.string().min(1),
    type: CardType.nullable().optional(),
    dataset_query: DatasetQuery,
    display: z.string().min(1),
    visualization_settings: z.record(z.string(), z.unknown()),
    description: z.string().min(1).nullable().optional(),
    entity_id: z.string().min(1).nullable().optional(),
    collection_id: CollectionIdOrEntityId.nullable().optional(),
    collection_position: z.number().int().positive().nullable().optional(),
    cache_ttl: z.number().int().positive().nullable().optional(),
    dashboard_id: z.number().int().positive().nullable().optional(),
    dashboard_tab_id: z.number().int().positive().nullable().optional(),
    parameters: z.array(Parameter).nullable().optional(),
    parameter_mappings: z.array(ParameterMapping).nullable().optional(),
    result_metadata: z.array(z.unknown()).nullable().optional(),
  })
  .loose();
export type CardCreateInput = z.infer<typeof CardCreateInput>;

export const CardUpdateInput = z
  .object({
    name: z.string().min(1).nullable().optional(),
    type: CardType.nullable().optional(),
    dataset_query: DatasetQuery.optional(),
    display: z.string().min(1).nullable().optional(),
    visualization_settings: z.record(z.string(), z.unknown()).nullable().optional(),
    description: z.string().nullable().optional(),
    archived: z.boolean().nullable().optional(),
    enable_embedding: z.boolean().nullable().optional(),
    embedding_type: z.string().nullable().optional(),
    embedding_params: EmbeddingParams.nullable().optional(),
    collection_id: z.number().int().positive().nullable().optional(),
    collection_position: z.number().int().positive().nullable().optional(),
    collection_preview: z.boolean().nullable().optional(),
    cache_ttl: z.number().int().positive().nullable().optional(),
    dashboard_id: z.number().int().positive().nullable().optional(),
    dashboard_tab_id: z.number().int().positive().nullable().optional(),
    parameters: z.array(Parameter).nullable().optional(),
    parameter_mappings: z.array(ParameterMapping).nullable().optional(),
    result_metadata: z.array(z.unknown()).nullable().optional(),
  })
  .loose();
export type CardUpdateInput = z.infer<typeof CardUpdateInput>;

const CardQueryData = z
  .object({
    rows: z.array(z.array(z.unknown())),
    cols: z.array(ResultColumn),
    // Present only when the server cut the rows short, carrying the row count it cut them at. A
    // query with a pivot reports it as `pivot_rows_truncated` instead.
    rows_truncated: z.number().int().optional(),
    pivot_rows_truncated: z.number().int().optional(),
  })
  .loose();

export const CardQueryResult = z
  .object({
    status: z.string(),
    row_count: z.number().int().nonnegative().optional(),
    data: CardQueryData.optional(),
    // When a completed run was served from the cache, the time the cached result was computed;
    // otherwise `null`. A run that failed leaves it out.
    cached: z.string().nullable().optional(),
    error: z.string().nullable().optional(),
    error_type: z.string().nullable().optional(),
  })
  .loose();
export type CardQueryResult = z.infer<typeof CardQueryResult>;

// The raw `/api/dataset` envelope carries heavy per-column `lib/*` metadata, fingerprints,
// `results_metadata`, and `native_form`. The compact projection keeps only what a reader of the
// rows needs — status, row_count, when a cached result was computed, the rows, a slim column
// header, and the row limit the server cut them at — so the default `--json` output isn't
// hundreds of lines of metadata. `--full` returns the raw envelope.
const ResultColumnCompact = ResultColumn.pick({
  name: true,
  display_name: true,
  base_type: true,
  semantic_type: true,
}).strip();

const CardQueryDataCompact = z
  .object({
    rows: z.array(z.array(z.unknown())),
    cols: z.array(ResultColumnCompact),
    rows_truncated: CardQueryData.shape.rows_truncated,
    pivot_rows_truncated: CardQueryData.shape.pivot_rows_truncated,
  })
  .strip();

export const CardQueryResultCompact = CardQueryResult.pick({
  status: true,
  row_count: true,
  cached: true,
  error: true,
  error_type: true,
})
  .strip()
  .extend({ data: CardQueryDataCompact.optional() });
export type CardQueryResultCompact = z.infer<typeof CardQueryResultCompact>;
