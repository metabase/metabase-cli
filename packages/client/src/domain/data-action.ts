import { z } from "zod";

import type { Features } from "../version/features";
import { gateInput } from "../version/input-gate-registry";
import type { InputGate } from "../version/input-gates";

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
    // A query-type data action carries its query and database; an implicit one has neither key, but
    // its `kind` and, when it has no model, the `table_id` it writes to.
    database_id: z.number().int().nullable().optional(),
    dataset_query: z.unknown().optional(),
    kind: z.string().optional(),
    table_id: z.number().int().nullable().optional(),
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
  table_id: true,
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

export const ImplicitActionKind = z.enum(["row/create", "row/update", "row/delete"]);
export type ImplicitActionKind = z.infer<typeof ImplicitActionKind>;

// A query action is a parameterized native query; an implicit action inserts, updates, or deletes one
// row of `table_id`, with the table's columns as its parameters. One object with every field, so the
// OpenAPI drift lane checks them all, and `type` picks the fields a body must and must not carry.
const DataActionCreateFields = z
  .object({
    name: z.string().min(1),
    type: z.enum(["query", "implicit"]),
    database_id: z.number().int().positive().optional(),
    dataset_query: DatasetQuery.optional(),
    parameters: z.array(DataActionParameterInput).optional(),
    kind: ImplicitActionKind.optional(),
    table_id: z.number().int().positive().optional(),
    collection_id: z.number().int().positive().nullable().optional(),
    description: z.string().nullable().optional(),
    visualization_settings: z.unknown().optional(),
  })
  .strict();

const FIELDS_OF_TYPE = {
  query: ["database_id", "dataset_query"],
  implicit: ["kind", "table_id"],
} as const;

const FIELDS_NOT_OF_TYPE = {
  query: ["kind", "table_id"],
  implicit: ["database_id", "dataset_query", "parameters"],
} as const;

export const DataActionCreateInput = DataActionCreateFields.superRefine((body, ctx) => {
  for (const field of FIELDS_OF_TYPE[body.type]) {
    if (body[field] === undefined) {
      ctx.addIssue({
        code: "custom",
        path: [field],
        message: `required when type is "${body.type}"`,
      });
    }
  }
  for (const field of FIELDS_NOT_OF_TYPE[body.type]) {
    if (body[field] !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: [field],
        message: `not allowed when type is "${body.type}"`,
      });
    }
  }
});
export type DataActionCreateInput = z.infer<typeof DataActionCreateInput>;

export const DATA_ACTION_COLLECTION_GATE: InputGate = {
  feature: "dataActionCollections",
  effect: "needs",
  when: { kind: "present" },
};

export const DataActionUpdateInput = z
  .object({
    name: z.string().min(1).optional(),
    database_id: z.number().int().positive().optional(),
    dataset_query: DatasetQuery.optional(),
    kind: ImplicitActionKind.optional(),
    table_id: z.number().int().positive().optional(),
    parameters: z.array(DataActionParameterInput).optional(),
    collection_id: gateInput(
      z.number().int().positive().nullable().optional(),
      DATA_ACTION_COLLECTION_GATE,
    ),
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

// A query action answers the rows it affected; an implicit one the rows it updated or deleted, or
// the row it created.
export const DataActionExecuteResult = z
  .object({
    "rows-affected": z.number().int().optional(),
    "rows-updated": z.number().int().optional(),
    "rows-deleted": z.number().int().optional(),
    "created-row": z.record(z.string(), z.unknown()).optional(),
  })
  .loose();
export type DataActionExecuteResult = z.infer<typeof DataActionExecuteResult>;
