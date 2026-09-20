import type { ParsedArgs } from "citty";

import { ConfigError } from "@metabase/client/errors";
import { TableSchemaId, TableSelectors } from "@metabase/client/domain/table";
import { parseCsv } from "../runtime/csv";
import { parseId } from "./parse-id";

export const tableSelectorFlags = {
  "table-ids": { type: "string", description: "Comma-separated table ids" },
  "db-ids": { type: "string", description: "Comma-separated database ids" },
  schemas: {
    type: "string",
    description:
      'Comma-separated schema ids, each "<db-id>:<schema>" (e.g. 1:public; 1: for the tables with no schema)',
  },
} as const;

type TableSelectorFlags = typeof tableSelectorFlags;
type TableSelectorArgs = Pick<ParsedArgs<TableSelectorFlags>, keyof TableSelectorFlags>;

const SELECTOR_FLAGS: Record<keyof TableSelectors, keyof TableSelectorFlags> = {
  table_ids: "table-ids",
  database_ids: "db-ids",
  schema_ids: "schemas",
};

export const SELECTION_DETAILS =
  'Select with --table-ids, --db-ids, or --schemas (each schema id is "<db-id>:<schema>", e.g. 1:public, and 1: selects the tables of database 1 that have no schema); the selectors are unioned. Only an admin or a data analyst may call it; anyone else gets a 403. The server answers the same whether or not a selector matched a table, so the output restates the accepted request and cannot say which tables were affected.';

export function selectionSummary(action: string, selectors: TableSelectors): string {
  const flags = TableSelectors.keyof()
    .options.filter((key) => selectors[key] !== undefined)
    .map((key) => `--${SELECTOR_FLAGS[key]}`);
  return `${action} accepted for the tables selected by ${flags.join(", ")}; the server does not report which tables matched.`;
}

function parseIdList(value: string | undefined, name: string): number[] {
  if (value === undefined) {
    return [];
  }
  return parseCsv(value).map((part) => parseId(part, name));
}

function parseSchemaId(value: string): string {
  if (!TableSchemaId.safeParse(value).success) {
    throw new ConfigError(
      `invalid schema id: "${value}" (expected "<db-id>:<schema>" with a positive database id)`,
    );
  }
  return value;
}

export function parseTableSelectors(args: TableSelectorArgs): TableSelectors {
  const tableIds = parseIdList(args["table-ids"], "table id");
  const databaseIds = parseIdList(args["db-ids"], "database id");
  const schemaNames = args.schemas === undefined ? [] : parseCsv(args.schemas).map(parseSchemaId);
  const selectors: TableSelectors = {};
  if (tableIds.length > 0) {
    selectors.table_ids = tableIds;
  }
  if (databaseIds.length > 0) {
    selectors.database_ids = databaseIds;
  }
  if (schemaNames.length > 0) {
    selectors.schema_ids = schemaNames;
  }
  if (Object.keys(selectors).length === 0) {
    throw new ConfigError("provide at least one selector: --table-ids, --db-ids, or --schemas");
  }
  return selectors;
}
