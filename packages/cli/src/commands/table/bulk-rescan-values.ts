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
  details: `Queues a rescan of the cached filter values of every selected table, and returns at once. Only the sets that are cached and were read in the last 14 days are refreshed. ${SELECTION_DETAILS}`,
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
