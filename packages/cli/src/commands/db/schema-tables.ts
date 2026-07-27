import { TableCompact } from "@metabase/client/domain/table";
import { tableView } from "../../output/views/table";
import { renderList } from "../../output/render";
import { listEnvelopeSchema } from "../../output/types";
import { windowList } from "../../output/window";
import { connectionFlags, listFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export const DatabaseSchemaTablesEnvelope = listEnvelopeSchema(TableCompact);

export default defineMetabaseCommand({
  meta: {
    name: "schema-tables",
    description: "List tables in a database schema",
  },
  capabilities: { minVersion: 58 },
  args: {
    ...outputFlags,
    ...listFlags,
    ...profileFlag,
    ...connectionFlags,
    id: { type: "positional", description: "Database id", required: true },
    schema: { type: "positional", description: "Schema name", required: true },
  },
  outputSchema: DatabaseSchemaTablesEnvelope,
  examples: ["mb db schema-tables 1 public", "mb db schema-tables 1 public --json"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const client = await getClient();
    const { data } = await client.database.schemaTables(id, args.schema);
    renderList(windowList(data, ctx.range), tableView, ctx);
  },
});
