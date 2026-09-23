import { stringify } from "yaml";

import type {
  MetadataExport,
  MetadataExportDatabase,
  MetadataExportField,
  MetadataExportTable,
} from "@metabase/client/domain/metadata-export";

// Natural keys stand in for the numeric ids: a database by name, a table by
// [database, schema, table], a field by the table key plus its name and, for a field nested in
// another, every parent name along the way.
type DatabaseKey = string;
type TableKey = [DatabaseKey, string | null, string];
type FieldKey = [...TableKey, string, ...string[]];

// Each document is the export's row with its numeric ids replaced by natural keys.
type DatabaseDocument = Omit<MetadataExportDatabase, "id">;

type FieldDocument = Omit<
  MetadataExportField,
  "id" | "table_id" | "parent_id" | "fk_target_field_id"
> & {
  parent_id?: FieldKey;
  fk_target_field_id?: FieldKey;
};

type TableDocument = Omit<MetadataExportTable, "id" | "db_id"> & {
  db_id: DatabaseKey;
  fields: FieldDocument[];
};

interface ExtractedFile {
  // Relative to the output directory, with `/` as the separator on every platform.
  path: string;
  content: string;
}

interface ExtractStats {
  databases: number;
  tables: number;
  fields: number;
}

export interface ExtractedTree {
  files: ExtractedFile[];
  stats: ExtractStats;
}

interface ExtractOptions {
  // Database names to keep; `null` keeps every database in the export.
  databases: readonly string[] | null;
}

interface MetadataIndex {
  databasesById: Map<number, MetadataExportDatabase>;
  tablesByDbId: Map<number, MetadataExportTable[]>;
  tablesById: Map<number, MetadataExportTable>;
  fieldsByTableId: Map<number, MetadataExportField[]>;
  fieldsById: Map<number, MetadataExportField>;
}

const SCHEMAS_DIR = "schemas";
const TABLES_DIR = "tables";
const YAML_EXTENSION = ".yaml";

function escapeFilename(name: string): string {
  return name.replace(/\//g, "__SLASH__").replace(/\\/g, "__BACKSLASH__");
}

function databaseDir(db: MetadataExportDatabase): string {
  return escapeFilename(db.name);
}

function tablesDir(db: MetadataExportDatabase, table: MetadataExportTable): string {
  if (table.schema !== null && table.schema !== "") {
    return [databaseDir(db), SCHEMAS_DIR, escapeFilename(table.schema), TABLES_DIR].join("/");
  }
  return [databaseDir(db), TABLES_DIR].join("/");
}

function databasePath(db: MetadataExportDatabase): string {
  return `${databaseDir(db)}/${escapeFilename(db.name)}${YAML_EXTENSION}`;
}

function tablePath(db: MetadataExportDatabase, table: MetadataExportTable): string {
  return `${tablesDir(db, table)}/${escapeFilename(table.name)}${YAML_EXTENSION}`;
}

function tableKey(db: MetadataExportDatabase, table: MetadataExportTable): TableKey {
  return [db.name, table.schema ?? null, table.name];
}

// `null` when a parent along the chain is missing from the export, in which case the reference
// cannot be spelled and is left out, as the reference extractor does.
function fieldKey(
  db: MetadataExportDatabase,
  table: MetadataExportTable,
  field: MetadataExportField,
  fieldsById: MetadataIndex["fieldsById"],
): FieldKey | null {
  const parentId = field.parent_id ?? null;
  if (parentId === null) {
    return [...tableKey(db, table), field.name];
  }
  const parent = fieldsById.get(parentId);
  if (parent === undefined) {
    return null;
  }
  const parentKey = fieldKey(db, table, parent, fieldsById);
  return parentKey === null ? null : [...parentKey, field.name];
}

function groupBy<T>(items: readonly T[], keyOf: (item: T) => number): Map<number, T[]> {
  const groups = new Map<number, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, [item]);
    } else {
      group.push(item);
    }
  }
  return groups;
}

function buildIndex(metadata: MetadataExport): MetadataIndex {
  return {
    databasesById: new Map(metadata.databases.map((db) => [db.id, db])),
    tablesByDbId: groupBy(metadata.tables, (table) => table.db_id),
    tablesById: new Map(metadata.tables.map((table) => [table.id, table])),
    fieldsByTableId: groupBy(metadata.fields, (field) => field.table_id),
    fieldsById: new Map(metadata.fields.map((field) => [field.id, field])),
  };
}

function databaseDocument(db: MetadataExportDatabase): DatabaseDocument {
  const { id: _id, ...document } = db;
  return document;
}

function tableDocument(
  db: MetadataExportDatabase,
  table: MetadataExportTable,
  fields: FieldDocument[],
): TableDocument {
  const { id: _id, db_id: _dbId, ...rest } = table;
  return { ...rest, db_id: db.name, fields };
}

function targetFieldKey(fieldId: number, index: MetadataIndex): FieldKey | null {
  const target = index.fieldsById.get(fieldId);
  if (target === undefined) {
    return null;
  }
  const targetTable = index.tablesById.get(target.table_id);
  if (targetTable === undefined) {
    return null;
  }
  const targetDb = index.databasesById.get(targetTable.db_id);
  if (targetDb === undefined) {
    return null;
  }
  return fieldKey(targetDb, targetTable, target, index.fieldsById);
}

function fieldDocument(
  db: MetadataExportDatabase,
  table: MetadataExportTable,
  field: MetadataExportField,
  index: MetadataIndex,
): FieldDocument {
  const { id: _id, table_id: _tableId, parent_id, fk_target_field_id, ...rest } = field;
  const document: FieldDocument = { ...rest };
  const parentId = parent_id ?? null;
  if (parentId !== null) {
    const parent = index.fieldsById.get(parentId);
    const parentKey = parent === undefined ? null : fieldKey(db, table, parent, index.fieldsById);
    if (parentKey !== null) {
      document.parent_id = parentKey;
    }
  }
  const targetId = fk_target_field_id ?? null;
  if (targetId !== null) {
    const targetKey = targetFieldKey(targetId, index);
    if (targetKey !== null) {
      document.fk_target_field_id = targetKey;
    }
  }
  return document;
}

// The reference tree was written by js-yaml; the same quoting keeps this output byte-identical.
function toYaml(value: unknown): string {
  return stringify(value, { lineWidth: 0, singleQuote: true });
}

function selectDatabases(
  databases: readonly MetadataExportDatabase[],
  wanted: readonly string[] | null,
): MetadataExportDatabase[] {
  if (wanted === null) {
    return [...databases];
  }
  const names = new Set(wanted);
  return databases.filter((db) => names.has(db.name));
}

export function extractTableMetadata(
  metadata: MetadataExport,
  options: ExtractOptions,
): ExtractedTree {
  const index = buildIndex(metadata);
  const files: ExtractedFile[] = [];
  const stats: ExtractStats = { databases: 0, tables: 0, fields: 0 };
  for (const db of selectDatabases(metadata.databases, options.databases)) {
    stats.databases += 1;
    files.push({ path: databasePath(db), content: toYaml(databaseDocument(db)) });
    for (const table of index.tablesByDbId.get(db.id) ?? []) {
      stats.tables += 1;
      const fields = (index.fieldsByTableId.get(table.id) ?? []).map((field) =>
        fieldDocument(db, table, field, index),
      );
      stats.fields += fields.length;
      files.push({ path: tablePath(db, table), content: toYaml(tableDocument(db, table, fields)) });
    }
  }
  return { files, stats };
}
