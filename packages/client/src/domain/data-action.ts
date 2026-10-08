import { z } from "zod";

import type { Features } from "../version/features";

import { DatasetQuery } from "./query";

export const DataActionParameter = z
  .object({
    id: z.string(),
    type: z.string(),
    name: z.string().optional(),
    slug: z.string().optional(),
    target: z.unknown().optional(),
    required: z.boolean().optional(),
  })
  .loose();
export type DataActionParameter = z.infer<typeof DataActionParameter>;

const DataActionBase = z
  .object({
    id: z.number().int(),
    name: z.string(),
    description: z.string().nullable(),
    type: z.string(),
    model_id: z.number().int().nullable(),
    // A query-type data action carries its query and database; an implicit one has neither key.
    database_id: z.number().int().nullable().optional(),
    dataset_query: z.unknown().optional(),
    parameters: z.array(DataActionParameter).nullable(),
    visualization_settings: z.unknown(),
    archived: z.boolean(),
    public_uuid: z.string().nullable(),
    entity_id: z.string().nullable(),
    creator_id: z.number().int(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .loose();

export const DataAction = DataActionBase.extend({
  collection_id: z.number().int().nullable(),
});
export type DataAction = z.infer<typeof DataAction>;

function withoutCollection(wire: z.infer<typeof DataActionBase>): DataAction {
  return { ...wire, collection_id: null };
}

/** The shape every data action endpoint answers on a server with `features`, read as `DataAction`. */
export function dataActionSchema(features: Features): z.ZodType<DataAction> {
  return features.dataActionCollections ? DataAction : DataActionBase.transform(withoutCollection);
}

export const DataActionCompact = DataAction.pick({
  id: true,
  name: true,
  type: true,
  collection_id: true,
  database_id: true,
  archived: true,
}).strip();
export type DataActionCompact = z.infer<typeof DataActionCompact>;

const DataActionParameterInput = z
  .object({
    id: z.string().min(1),
    type: z.string().min(1),
    name: z.string().optional(),
    slug: z.string().optional(),
    target: z.unknown(),
    required: z.boolean().optional(),
  })
  .loose();

export const DataActionCreateInput = z
  .object({
    name: z.string().min(1),
    type: z.literal("query"),
    database_id: z.number().int().positive(),
    dataset_query: DatasetQuery,
    parameters: z.array(DataActionParameterInput).optional(),
    collection_id: z.number().int().positive().nullable().optional(),
    description: z.string().nullable().optional(),
    visualization_settings: z.unknown().optional(),
  })
  .strict();
export type DataActionCreateInput = z.infer<typeof DataActionCreateInput>;

export const DataActionUpdateInput = z
  .object({
    name: z.string().min(1).optional(),
    database_id: z.number().int().positive().optional(),
    dataset_query: DatasetQuery.optional(),
    parameters: z.array(DataActionParameterInput).optional(),
    collection_id: z.number().int().positive().nullable().optional(),
    description: z.string().nullable().optional(),
    visualization_settings: z.unknown().optional(),
    archived: z.boolean().optional(),
  })
  .strict();
export type DataActionUpdateInput = z.infer<typeof DataActionUpdateInput>;

const DataActionParameterValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const DataActionExecuteInput = z
  .object({ parameters: z.record(z.string(), DataActionParameterValue) })
  .strict();
export type DataActionExecuteInput = z.infer<typeof DataActionExecuteInput>;

export const DataActionExecuteResult = z.object({ "rows-affected": z.number().int() }).loose();
export type DataActionExecuteResult = z.infer<typeof DataActionExecuteResult>;
