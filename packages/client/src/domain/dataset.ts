import { z } from "zod";

import type { Features } from "../version/features";
import {
  Database,
  DatabaseCompact,
  DatabaseVirtualTable,
  DatabaseVirtualTableCompact,
} from "./database";
import { Field, FieldBaseType, FieldCompact, FieldSemanticType } from "./field";
import { Snippet, SnippetCompact } from "./snippet";
import { TableQueryMetadata, TableQueryMetadataCompact } from "./table";

export const CompiledQuery = z
  .object({
    // A SQL driver compiles to one string; a document driver's pipeline is a string under `pretty`
    // and a stage list otherwise.
    query: z.union([z.string(), z.array(z.unknown())]),
    params: z.array(z.unknown()).nullable().optional(),
    // A document driver's source collection, absent for a query that reads none. `null` is a server
    // that drops the key from every answer, so it cannot say.
    collection: z.string().nullable().optional(),
  })
  .loose();
export type CompiledQuery = z.infer<typeof CompiledQuery>;

const CompiledQueryWireWithoutCollection = CompiledQuery.omit({ collection: true });

function withUnknownCollection(
  wire: z.infer<typeof CompiledQueryWireWithoutCollection>,
): CompiledQuery {
  return { ...wire, collection: null };
}

/** The shape `POST /api/dataset/native` answers on a server with `features`, read as `CompiledQuery`. */
export function compiledQuerySchema(features: Features): z.ZodType<CompiledQuery> {
  return features.compiledQueryOmitsCollection
    ? CompiledQueryWireWithoutCollection.transform(withUnknownCollection)
    : CompiledQuery;
}

export const CompiledQueryCompact = CompiledQuery.pick({
  query: true,
  params: true,
  collection: true,
}).strip();
export type CompiledQueryCompact = z.infer<typeof CompiledQueryCompact>;

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

export const VirtualFieldCompact = VirtualField.pick({
  id: true,
  table_id: true,
  name: true,
  display_name: true,
  base_type: true,
  semantic_type: true,
  fk_target_field_id: true,
}).strip();
export type VirtualFieldCompact = z.infer<typeof VirtualFieldCompact>;

// A card standing in as a source table, id `card__<id>`, with its columns.
export const VirtualTable = DatabaseVirtualTable.extend({ fields: z.array(VirtualField) });
export type VirtualTable = z.infer<typeof VirtualTable>;

export const VirtualTableCompact = DatabaseVirtualTableCompact.extend({
  fields: z.array(VirtualFieldCompact),
});
export type VirtualTableCompact = z.infer<typeof VirtualTableCompact>;

export const QueryMetadata = z
  .object({
    databases: z.array(Database),
    tables: z.array(z.union([TableQueryMetadata, VirtualTable])),
    fields: z.array(Field),
    snippets: z.array(Snippet),
  })
  .loose();
export type QueryMetadata = z.infer<typeof QueryMetadata>;

// A real table's id is a number and a virtual table's a `card__N` string, which is what tells the
// two members apart.
export const QueryMetadataCompact = z.object({
  databases: z.array(DatabaseCompact),
  tables: z.array(z.union([TableQueryMetadataCompact, VirtualTableCompact])),
  fields: z.array(FieldCompact),
  snippets: z.array(SnippetCompact),
});
export type QueryMetadataCompact = z.infer<typeof QueryMetadataCompact>;
