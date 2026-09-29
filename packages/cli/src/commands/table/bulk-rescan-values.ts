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
    name: "bulk-rescan-values",
    description: "Trigger a rescan of cached field values for every table a selector picks out",
  },
  details: `Queues an async rescan of the distinct values behind the filter dropdowns of every selected table and returns immediately. Only the sets already cached and read in the last 14 days are refreshed; a set never read, discarded, or unread for longer is skipped until a read rebuilds or revives it. ${SELECTION_DETAILS}`,
  requires: ["table.bulkRescanValues"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...tableSelectorFlags,
  },
  outputSchema: TableSelectionResult,
  examples: [
    "mb table bulk-rescan-values --db-ids 1",
    "mb table bulk-rescan-values --schemas 1:public --json",
  ],
  async run({ args, ctx, getClient }) {
    const selectors = parseTableSelectors(args);
    const client = await getClient();
    const result = await client.table.bulkRescanValues(selectors);
    renderSummary(
      result,
      tableSelectionResultView,
      selectionSummary("Field-values rescan", selectors),
      ctx,
    );
  },
});
