import { TableSelectionResult } from "@metabase/client/domain/table";

import { renderSummary } from "../../output/render";
import { tableSelectionResultView } from "../../output/views/table";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";
import {
  parseTableSelectors,
  SELECTION_DETAILS,
  selectionSummary,
  tableSelectorFlags,
} from "../table-selector-flags";

export default defineMetabaseCommand({
  meta: {
    name: "bulk-sync-schema",
    description: "Trigger a schema sync for every table a selector picks out",
  },
  details: `Queues an async sync of every selected table and returns immediately; each sync re-reads the table's columns, fingerprints them, and refreshes its cached field values, and none discovers new tables (\`mb db sync-schema <db-id>\` does). Every database behind the selection must pass a connection test first, or the call is refused with a 422. ${SELECTION_DETAILS}`,
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
