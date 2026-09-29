import { ConfigError } from "@metabase/client/errors";
import { TableSchemaId, TableSelectors } from "@metabase/client/domain/table";
import type { FlagValues } from "./flag-values";
import { parseIdCsv } from "./parse-id";

export const tableSelectorFlags = {
  "table-ids": { type: "string", list: true, description: "Comma-separated table ids" },
  "db-ids": { type: "string", list: true, description: "Comma-separated database ids" },
  schemas: {
    type: "string",
    list: true,
    description:
      'Comma-separated schema ids, each "<db-id>:<schema>" (e.g. 1:public; 1: for the tables with no schema)',
  },
} as const;

type TableSelectorFlags = typeof tableSelectorFlags;
type TableSelectorArgs = FlagValues<TableSelectorFlags>;

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

function parseSchemaId(part: string): string {
  const value = part.trim();
  if (!TableSchemaId.safeParse(value).success) {
    throw new ConfigError(
      `invalid schema id: "${value}" (expected "<db-id>:<schema>" with a positive database id)`,
    );
  }
  return value;
}

export function parseTableSelectors(args: TableSelectorArgs): TableSelectors {
  const selectors: TableSelectors = {};
  if (args["table-ids"] !== undefined) {
    selectors.table_ids = parseIdCsv(args["table-ids"], "table id");
  }
  if (args["db-ids"] !== undefined) {
    selectors.database_ids = parseIdCsv(args["db-ids"], "database id");
  }
  if (args.schemas !== undefined) {
    selectors.schema_ids = args.schemas.split(",").map(parseSchemaId);
  }
  if (Object.keys(selectors).length === 0) {
    throw new ConfigError("provide at least one selector: --table-ids, --db-ids, or --schemas");
  }
  return selectors;
}
