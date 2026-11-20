import { Table, TableUpdateInput } from "@metabase/client/domain/table";
import { tableView } from "../../output/views/table";
import { renderSummary } from "../../output/render";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: {
    name: "update",
    description: "Update a table (display name, description, visibility, etc.)",
  },
  details:
    "`display_name`, `entity_type`, `show_in_getting_started`, `field_order` and `collection_id` take no `null`: the server would drop it and leave the value as it was. Two values a server would take without doing what they ask are refused before the request (exit 2): `data_authority: null` before Metabase 64, which the server writes into a column that takes no `null`, failing with a bare 500 or storing something other than a withdrawal; and a medallion `data_layer` (`gold`, `silver`, `bronze`, `copper`) on a server that names its layers `final`, `internal`, `hidden`, which would map it onto one of those. Whether an update moves a table to `collection_id` depends on the server's patch release, so the command checks the table the server answers: a server that drops the key applies the rest of the update and leaves the table where it was, which the command reports as a `partial-write` error (exit 1) naming the collection the table stayed in.",
  requires: ["table.update"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...bodyInputFlags,
    id: { type: "positional", description: "Table id", required: true },
  },
  inputSchema: TableUpdateInput,
  outputSchema: Table,
  examples: [
    'mb table update 42 --body \'{"display_name":"Customers"}\'',
    "mb table update 42 --file patch.json",
    "cat patch.json | mb table update 42",
  ],
  async run({ args, ctx, getClient, readBody }) {
    const id = parseId(args.id);
    const body = await readBody({ flag: args.body, file: args.file });
    const client = await getClient();
    const updated = await client.table.update(id, body);
    renderSummary(
      updated,
      tableView,
      `Updated table ${updated.id} "${updated.display_name}".`,
      ctx,
    );
  },
});
