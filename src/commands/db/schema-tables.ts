import { z } from "zod";

import { Table, TableCompact, tableView } from "../../domain/table";
import { renderList } from "../../output/render";
import { listEnvelopeSchema, wrapList } from "../../output/types";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

const SchemaTablesApiResponse = z.array(Table);

export const DatabaseSchemaTablesEnvelope = listEnvelopeSchema(TableCompact);

export default defineMetabaseCommand({
  meta: {
    name: "schema-tables",
    description: "List tables in a database schema",
  },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    id: { type: "positional", description: "Database id", required: true },
    schema: { type: "positional", description: "Schema name", required: true },
  },
  outputSchema: DatabaseSchemaTablesEnvelope,
  examples: ["metabase db schema-tables 1 public", "metabase db schema-tables 1 public --json"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const client = await getClient();
    const tables = await client.requestParsed(
      SchemaTablesApiResponse,
      `/api/database/${id}/schema/${encodeURIComponent(args.schema)}`,
    );
    renderList(wrapList(tables), tableView, ctx);
  },
});
