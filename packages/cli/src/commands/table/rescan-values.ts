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
    "Queues an async rescan of the distinct values behind this table's filter dropdowns and returns immediately with the server's `success` acknowledgement. Only the sets already cached and read in the last 14 days are refreshed; a set never read, discarded, or unread for longer is skipped until a read rebuilds or revives it. To rescan a set of tables use `mb table bulk-rescan-values`.",
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
