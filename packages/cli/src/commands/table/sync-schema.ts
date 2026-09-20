import { TableSchemaSyncResult } from "@metabase/client/domain/table";

import { renderSummary } from "../../output/render";
import { tableSchemaSyncResultView } from "../../output/views/table";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: {
    name: "sync-schema",
    description: "Trigger a manual schema sync for one table",
  },
  details:
    "Queues an async sync of this one table and returns immediately; the server reports no completion to wait on. The sync re-reads the table's columns, fingerprints them, and refreshes its cached field values; it never discovers new tables, so use `mb db sync-schema <db-id>` for a table the warehouse just gained. A warehouse the server cannot connect to is refused with a 422. To sync a set of tables use `mb table bulk-sync-schema`.",
  requires: ["table.syncSchema"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    id: { type: "positional", description: "Table id", required: true },
  },
  outputSchema: TableSchemaSyncResult,
  examples: ["mb table sync-schema 42", "mb table sync-schema 42 --json"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const client = await getClient();
    const result = await client.table.syncSchema(id);
    renderSummary(result, tableSchemaSyncResultView, `Schema sync queued for table ${id}.`, ctx);
  },
});
