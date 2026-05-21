import { z } from "zod";

import { Table, TableCompact, tableView } from "../../domain/table";
import { renderList } from "../../output/render";
import { listEnvelopeSchema, wrapList } from "../../output/types";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

const TableApiList = z.array(Table);

export const TableListEnvelope = listEnvelopeSchema(TableCompact);

export default defineMetabaseCommand({
  meta: { name: "list", description: "List tables (optionally filtered by database)" },
  capabilities: { minVersion: 58 },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    "db-id": { type: "string", description: "Filter by database id" },
  },
  outputSchema: TableListEnvelope,
  examples: ["mb table list", "mb table list --db-id 1 --json"],
  async run({ args, ctx, getClient }) {
    const dbIdFilter = args["db-id"] === undefined ? undefined : parseId(args["db-id"], "db-id");
    const client = await getClient();
    const all = await client.requestParsed(TableApiList, "/api/table");
    const filtered = dbIdFilter === undefined ? all : all.filter((row) => row.db_id === dbIdFilter);
    renderList(wrapList(filtered), tableView, ctx);
  },
});
