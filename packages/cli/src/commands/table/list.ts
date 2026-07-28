import { TableCompact } from "@metabase/client/domain/table";
import { tableView } from "../../output/views/table";
import { renderList } from "../../output/render";
import { listEnvelopeSchema } from "../../output/types";
import { windowList } from "../../output/window";
import { connectionFlags, listFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export const TableListEnvelope = listEnvelopeSchema(TableCompact);

export default defineMetabaseCommand({
  meta: { name: "list", description: "List tables (optionally filtered by database)" },
  capabilities: { minVersion: 58 },
  args: {
    ...outputFlags,
    ...listFlags,
    ...profileFlag,
    ...connectionFlags,
    "db-id": { type: "string", description: "Filter by database id" },
  },
  outputSchema: TableListEnvelope,
  examples: ["mb table list", "mb table list --db-id 1 --json"],
  async run({ args, ctx, getClient }) {
    const dbIdFilter = args["db-id"] === undefined ? undefined : parseId(args["db-id"], "db-id");
    const client = await getClient();
    const { data } = await client.table.list();
    const filtered =
      dbIdFilter === undefined ? data : data.filter((row) => row.db_id === dbIdFilter);
    renderList(windowList(filtered, ctx.range), tableView, ctx);
  },
});
