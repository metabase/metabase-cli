import { z } from "zod";

import { CardType } from "./card";
import { Database } from "./database";
import { Field, FieldBaseType, FieldSemanticType } from "./field";
import { Snippet } from "./snippet";
import { TableQueryMetadata } from "./table";

export const CompiledQuery = z
  .object({
    // A SQL driver compiles to one string; a document driver's pipeline is a string under `pretty`
    // and a stage list otherwise.
    query: z.union([z.string(), z.array(z.unknown())]),
    params: z.array(z.unknown()).nullable().optional(),
    collection: z.string().optional(),
  })
  .loose();
export type CompiledQuery = z.infer<typeof CompiledQuery>;

const FieldRef = z.tuple([
  z.literal("field"),
  z.string(),
  z.object({ "base-type": FieldBaseType }).loose(),
]);

export const VirtualField = z
  .object({
    // A native card's column has no field of its own, so it is keyed by a field ref.
    id: z.union([z.number().int(), FieldRef]),
    table_id: z.string(),
    name: z.string(),
    display_name: z.string(),
    base_type: FieldBaseType,
    semantic_type: FieldSemanticType.nullable(),
    fk_target_field_id: z.number().int().nullable().optional(),
  })
  .loose();
export type VirtualField = z.infer<typeof VirtualField>;

// A card standing in as a source table, id `card__<id>`.
export const VirtualTable = z
  .object({
    id: z.string(),
    db_id: z.number().int(),
    display_name: z.string(),
    schema: z.string(),
    description: z.string().nullable(),
    type: CardType,
    moderated_status: z.string().nullable(),
    entity_id: z.string().nullable(),
    fields: z.array(VirtualField),
  })
  .loose();
export type VirtualTable = z.infer<typeof VirtualTable>;

export const QueryMetadata = z
  .object({
    databases: z.array(Database),
    tables: z.array(z.union([TableQueryMetadata, VirtualTable])),
    fields: z.array(Field),
    snippets: z.array(Snippet),
  })
  .loose();
export type QueryMetadata = z.infer<typeof QueryMetadata>;
