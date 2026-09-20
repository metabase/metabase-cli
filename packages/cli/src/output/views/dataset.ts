import { z } from "zod";

import { Database } from "@metabase/client/domain/database";
import {
  type CompiledQuery,
  CompiledQueryCompact,
  type QueryMetadata,
  QueryMetadataCompact,
  VirtualTable,
} from "@metabase/client/domain/dataset";
import { Field } from "@metabase/client/domain/field";
import { Snippet } from "@metabase/client/domain/snippet";
import { TableQueryMetadata } from "@metabase/client/domain/table";

import { MALFORMED_CELL } from "../table";
import type { ResourceView } from "../view";

const DatabaseNames = z.array(Database.pick({ name: true }));
const TableNames = z.array(
  z.union([
    TableQueryMetadata.pick({ display_name: true }),
    VirtualTable.pick({ display_name: true }),
  ]),
);
const FieldNames = z.array(Field.pick({ display_name: true }));
const SnippetNames = z.array(Snippet.pick({ name: true }));

function joinLabels<T>(schema: z.ZodType<T[]>, label: (item: T) => string) {
  return (value: unknown): string => {
    const parsed = schema.safeParse(value);
    return parsed.success ? parsed.data.map(label).join(", ") : MALFORMED_CELL;
  };
}

export const compiledQueryView: ResourceView<CompiledQuery> = {
  compactPick: CompiledQueryCompact,
  tableColumns: [
    { key: "query", label: "Query" },
    { key: "params", label: "Params" },
    { key: "collection", label: "Collection" },
  ],
};

export const queryMetadataView: ResourceView<QueryMetadata> = {
  compactPick: QueryMetadataCompact,
  tableColumns: [
    {
      key: "databases",
      label: "Databases",
      format: joinLabels(DatabaseNames, (database) => database.name),
    },
    {
      key: "tables",
      label: "Tables",
      format: joinLabels(TableNames, (table) => table.display_name),
    },
    {
      key: "fields",
      label: "Fields",
      format: joinLabels(FieldNames, (field) => field.display_name),
    },
    {
      key: "snippets",
      label: "Snippets",
      format: joinLabels(SnippetNames, (snippet) => snippet.name),
    },
  ],
};
