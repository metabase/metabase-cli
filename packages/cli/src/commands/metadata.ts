import {
  hasDropdownValues,
  MetadataField,
  metadataFields,
  MetadataTable,
  metadataTables,
  rawValues,
} from "../core/metadata";
import { renderList } from "../output/render";
import { listEnvelopeSchema } from "../output/types";
import type { ResourceView } from "../output/view";
import { databaseView } from "../output/views/database";
import { windowList } from "../output/window";
import { connectionFlags, listFlags, outputFlags, profileFlag } from "./flags";
import { parseId } from "./parse-id";
import { defineMetabaseCommand } from "./runtime";

const formatRef = (value: unknown): string => JSON.stringify(value);

const metadataTableView: ResourceView<MetadataTable> = {
  compactPick: MetadataTable,
  tableColumns: [
    { key: "id", label: "ID" },
    { key: "ref", label: "Ref", format: formatRef },
    { key: "display_name", label: "Display name" },
  ],
};

const metadataFieldView: ResourceView<MetadataField> = {
  compactPick: MetadataField,
  tableColumns: [
    { key: "id", label: "ID" },
    { key: "name", label: "Name" },
    { key: "base_type", label: "Base type" },
    { key: "semantic_type", label: "Semantic type" },
    { key: "fk_target", label: "FK target", format: formatRef },
    { key: "values", label: "Values", format: formatRef },
  ],
};

const MetadataFieldListEnvelope = listEnvelopeSchema(MetadataField);

export default defineMetabaseCommand({
  meta: {
    name: "metadata",
    description: "Read warehouse metadata: databases, then tables, then fields",
  },
  details:
    "Drill down one level per call: no ids lists databases, a database id lists its tables, a database id and a table id list the table's fields. Every table and field row carries `ref`, the natural key a representation YAML file writes (`[database, schema, table]` / `[database, schema, table, field]`); `fk_target` is the ref of the field a foreign key points at; `values` holds the distinct values of a dropdown (list) field.",
  skills: [{ skill: "core", purpose: "the metadata -> edit -> check -> save loop" }],
  requires: ["database.list", "database.get", "field.values"],
  args: {
    ...outputFlags,
    ...listFlags,
    ...profileFlag,
    ...connectionFlags,
    database: { type: "positional", description: "Database id", required: false },
    table: { type: "positional", description: "Table id", required: false },
  },
  outputSchema: MetadataFieldListEnvelope,
  examples: ["mb metadata", "mb metadata 1", "mb metadata 1 42 --json"],
  async run({ args, ctx, getClient }) {
    const client = await getClient();
    if (args.database === undefined) {
      const { data, total } = await client.database.list();
      renderList(windowList(data, ctx.range, total), databaseView, ctx);
      return;
    }
    const databaseId = parseId(args.database, "database");
    if (args.table === undefined) {
      const database = await client.database.get(databaseId, { include: "tables" });
      renderList(windowList(metadataTables(database), ctx.range), metadataTableView, ctx);
      return;
    }
    const tableId = parseId(args.table, "table");
    const database = await client.database.get(databaseId, { include: "tables.fields" });
    const fields = metadataFields(database, tableId);
    await Promise.all(
      fields.filter(hasDropdownValues).map(async (field) => {
        const { values } = await client.field.values(field.id);
        field.values = rawValues(values);
      }),
    );
    renderList(windowList(fields, ctx.range), metadataFieldView, ctx);
  },
});
