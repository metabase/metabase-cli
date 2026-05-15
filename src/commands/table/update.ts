import { Table, TableUpdateInput, tableView } from "../../domain/table";
import { renderItem } from "../../output/render";
import { readBody } from "../../runtime/body";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: {
    name: "update",
    description: "Update a table (display name, description, visibility, etc.)",
  },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...bodyInputFlags,
    id: { type: "positional", description: "Table id", required: true },
  },
  outputSchema: Table,
  examples: [
    'mb table update 42 --body \'{"display_name":"Customers"}\'',
    "mb table update 42 --file patch.json",
    "cat patch.json | mb table update 42",
  ],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const body = await readBody({ flag: args.body, file: args.file }, TableUpdateInput);
    const client = await getClient();
    const updated = await client.requestParsed(Table, `/api/table/${id}`, {
      method: "PUT",
      body,
    });
    renderItem(updated, tableView, ctx);
  },
});
