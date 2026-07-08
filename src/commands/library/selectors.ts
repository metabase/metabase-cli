import { ConfigError } from "../../core/errors";
import { parseCsv } from "../../runtime/csv";
import { parseId } from "../parse-id";

export const tableSelectorFlags = {
  "table-ids": { type: "string", description: "Comma-separated table ids" },
  "db-ids": { type: "string", description: "Comma-separated database ids" },
  schemas: {
    type: "string",
    description: 'Comma-separated schema ids, each "<db-id>:<schema>" (e.g. 1:public)',
  },
} as const;

export interface TableSelectors {
  database_ids?: number[];
  schema_ids?: string[];
  table_ids?: number[];
}

export interface TableSelectorArgs {
  "table-ids"?: string | undefined;
  "db-ids"?: string | undefined;
  schemas?: string | undefined;
}

function parseIdList(value: string | undefined, name: string): number[] {
  if (value === undefined) {
    return [];
  }
  return parseCsv(value).map((part) => parseId(part, name));
}

export function parseTableSelectors(args: TableSelectorArgs): TableSelectors {
  const tableIds = parseIdList(args["table-ids"], "table id");
  const databaseIds = parseIdList(args["db-ids"], "database id");
  const schemaNames = args.schemas === undefined ? [] : parseCsv(args.schemas);
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
