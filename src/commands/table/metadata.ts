import { TableQueryMetadata, tableView } from "../../domain/table";
import { renderItem } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: {
    name: "metadata",
    description: "Get a table with its fields, FKs, and dimensions hydrated",
  },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    id: { type: "positional", description: "Table id", required: true },
  },
  outputSchema: TableQueryMetadata,
  examples: ["mb table metadata 42", "mb table metadata 42 --json"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const client = await getClient();
    const table = await client.requestParsed(TableQueryMetadata, `/api/table/${id}/query_metadata`);
    renderItem(table, tableView, ctx);
  },
});
