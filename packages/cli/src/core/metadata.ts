import { z } from "zod";

import type { Database } from "@metabase/client/domain/database";
import { FieldBaseType, FieldSemanticType, FieldValuesType } from "@metabase/client/domain/field";
import type { Field } from "@metabase/client/domain/field";
import type { Table } from "@metabase/client/domain/table";
import { ConfigError } from "@metabase/client/errors";

// The representation format names warehouse objects by natural key, never numeric id, so every row
// carries the exact ref a YAML file writes.
export const TableRef = z.tuple([z.string(), z.string().nullable(), z.string()]);
export type TableRef = z.infer<typeof TableRef>;

export const FieldRef = z.tuple([z.string(), z.string().nullable(), z.string(), z.string()]);
export type FieldRef = z.infer<typeof FieldRef>;

export const MetadataTable = z.object({
  id: z.number().int(),
  schema: z.string().nullable(),
  name: z.string(),
  display_name: z.string(),
  description: z.string().nullable(),
  ref: TableRef,
});
export type MetadataTable = z.infer<typeof MetadataTable>;

export const MetadataField = z.object({
  id: z.number().int(),
  name: z.string(),
  display_name: z.string(),
  description: z.string().nullable(),
  base_type: FieldBaseType,
  semantic_type: FieldSemanticType.nullable(),
  has_field_values: FieldValuesType.nullable(),
  ref: FieldRef,
  fk_target: FieldRef.nullable(),
  values: z.array(z.unknown()).nullable(),
});
export type MetadataField = z.infer<typeof MetadataField>;

const DROPDOWN_VALUE_TYPES = new Set<string>(["list", "auto-list"]);

function tablesOf(database: Database): Table[] {
  if (database.tables === undefined) {
    throw new Error(`internal: database ${database.id} was fetched without tables`);
  }
  return database.tables;
}

function fieldsOf(table: Table): Field[] {
  if (table.fields === undefined) {
    throw new Error(`internal: table ${table.id} was fetched without fields`);
  }
  return table.fields;
}

function tableRef(database: Database, table: Table): TableRef {
  return [database.name, table.schema, table.name];
}

export function metadataTables(database: Database): MetadataTable[] {
  return tablesOf(database).map((table) => ({
    id: table.id,
    schema: table.schema,
    name: table.name,
    display_name: table.display_name,
    description: table.description,
    ref: tableRef(database, table),
  }));
}

function fieldRefIndex(database: Database): Map<number, FieldRef> {
  const index = new Map<number, FieldRef>();
  for (const table of tablesOf(database)) {
    for (const field of fieldsOf(table)) {
      index.set(field.id, [database.name, table.schema, table.name, field.name]);
    }
  }
  return index;
}

// `database` must be fetched with `include: "tables.fields"` so FK targets in any table of the
// database resolve to natural keys without a request per target.
export function metadataFields(database: Database, tableId: number): MetadataField[] {
  const table = tablesOf(database).find((candidate) => candidate.id === tableId);
  if (table === undefined) {
    throw new ConfigError(`table ${tableId} is not in database ${database.id} (${database.name})`);
  }
  const refs = fieldRefIndex(database);
  return fieldsOf(table).map((field) => {
    const target = field.fk_target_field_id === null ? null : refs.get(field.fk_target_field_id);
    return {
      id: field.id,
      name: field.name,
      display_name: field.display_name,
      description: field.description,
      base_type: field.base_type,
      semantic_type: field.semantic_type,
      has_field_values: field.has_field_values ?? null,
      ref: [database.name, table.schema, table.name, field.name],
      fk_target: target ?? null,
      values: null,
    };
  });
}

export function hasDropdownValues(field: MetadataField): boolean {
  return field.has_field_values !== null && DROPDOWN_VALUE_TYPES.has(field.has_field_values);
}

// A values row is `[value]`, or `[value, remapped label]` when the field is remapped; YAML filters
// compare against the raw value.
export function rawValues(rows: readonly (readonly unknown[])[]): unknown[] {
  return rows.map((row) => row[0]);
}
