import { Table, tableView } from "../../domain/table";
import { renderItem } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "get", description: "Get a table by id, with its fields" },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    id: { type: "positional", description: "Table id", required: true },
  },
  outputSchema: Table,
  examples: ["metabase table get 42", "metabase table get 42 --json"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const client = await getClient();
    const table = await client.requestParsed(Table, `/api/table/${id}/query_metadata`);
    renderItem(table, tableView, ctx);
  },
});
