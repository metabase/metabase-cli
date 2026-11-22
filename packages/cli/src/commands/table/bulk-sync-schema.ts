import { TableSelectionResult } from "@metabase/client/domain/table";

import { renderSummary } from "../../output/render";
import { tableSelectionResultView } from "../../output/views/table";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";
import { parseTableSelectors, selectionSummary, tableSelectorFlags } from "../table-selector-flags";

export default defineMetabaseCommand({
  meta: {
    name: "bulk-sync-schema",
    description: "Trigger a schema sync for every table a selector picks out",
  },
  details:
    "Runs [`mb table sync-schema`](#mb-table-sync-schema) on every selected table, and returns at once. Refused with a 422 unless every database behind the selection passes a connection test.",
  requires: ["table.bulkSyncSchema"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...tableSelectorFlags,
  },
  outputSchema: TableSelectionResult,
  examples: [
    "mb table bulk-sync-schema --schemas 1:public",
    "mb table bulk-sync-schema --table-ids 42,43 --json",
  ],
  async run({ args, ctx, getClient }) {
    const selectors = parseTableSelectors(args);
    const client = await getClient();
    const result = await client.table.bulkSyncSchema(selectors);
    renderSummary(
      result,
      tableSelectionResultView,
      selectionSummary("Schema sync", selectors),
      ctx,
    );
  },
});
