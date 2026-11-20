import { TableFieldValuesResult } from "@metabase/client/domain/table";

import { renderSummary } from "../../output/render";
import { tableFieldValuesResultView } from "../../output/views/table";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: {
    name: "rescan-values",
    description: "Trigger a rescan of cached field values for one table",
  },
  details:
    "Queues a rescan of this table's cached filter values, and returns the server's `success` at once. Only the sets that are cached and were read in the last 14 days are refreshed. For several tables, use `mb table bulk-rescan-values`.",
  requires: ["table.rescanValues"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    id: { type: "positional", description: "Table id", required: true },
  },
  outputSchema: TableFieldValuesResult,
  examples: ["mb table rescan-values 42", "mb table rescan-values 42 --json"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const client = await getClient();
    const result = await client.table.rescanValues(id);
    renderSummary(
      result,
      tableFieldValuesResultView,
      `Field-values rescan queued for table ${id}.`,
      ctx,
    );
  },
});
