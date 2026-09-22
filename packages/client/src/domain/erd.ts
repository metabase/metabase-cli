import { z } from "zod";

import { FieldBaseType, FieldSemanticType } from "./field";
import { TableVisibilityType } from "./table";

// `fk_target_field_id` and `fk_target_table_id` are `null` when the field is no foreign key or when
// its target table is one the caller may not read; a readable target outside the drawn nodes still
// carries both, so a caller can widen the diagram towards it.
export const ErdField = z
  .object({
    id: z.number().int(),
    name: z.string(),
    display_name: z.string(),
    database_type: z.string(),
    base_type: FieldBaseType.nullable(),
    effective_type: FieldBaseType.nullable(),
    semantic_type: FieldSemanticType.nullable(),
    fk_target_field_id: z.number().int().nullable(),
    fk_target_table_id: z.number().int().nullable(),
  })
  .loose();
export type ErdField = z.infer<typeof ErdField>;

// A user when `owner_user_id` names one, else the bare `owner_email`, else `null`.
const ErdOwner = z
  .object({
    id: z.number().int().optional(),
    email: z.string(),
    first_name: z.string().nullable().optional(),
    last_name: z.string().nullable().optional(),
  })
  .loose()
  .nullable();

export const ErdNode = z
  .object({
    table_id: z.number().int(),
    name: z.string(),
    display_name: z.string(),
    description: z.string().nullable(),
    owner: ErdOwner,
    schema: z.string().nullable(),
    visibility_type: TableVisibilityType.nullable(),
    db_id: z.number().int(),
    fields: z.array(ErdField),
  })
  .loose();
export type ErdNode = z.infer<typeof ErdNode>;

// `one-to-one` when both ends are primary keys in the warehouse, else `many-to-one` from the source.
export const ErdEdge = z
  .object({
    source_table_id: z.number().int(),
    source_field_id: z.number().int(),
    target_table_id: z.number().int(),
    target_field_id: z.number().int(),
    relationship: z.enum(["one-to-one", "many-to-one"]),
  })
  .loose();
export type ErdEdge = z.infer<typeof ErdEdge>;

export const Erd = z
  .object({
    nodes: z.array(ErdNode),
    edges: z.array(ErdEdge),
  })
  .loose();
export type Erd = z.infer<typeof Erd>;
