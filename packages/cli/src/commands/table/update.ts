import {
  DATA_AUTHORITY_WITHDRAWAL_GATE,
  DATA_LAYER_MEDALLION_GATE,
  Table,
  TableUpdateInput,
} from "@metabase/client/domain/table";
import { featureAvailability } from "@metabase/client/version/features";
import { tableView } from "../../output/views/table";
import { renderSummary } from "../../output/render";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

const WITHDRAWAL_FEATURE = DATA_AUTHORITY_WITHDRAWAL_GATE.feature;
const TIER_FEATURE = DATA_LAYER_MEDALLION_GATE.feature;

export default defineMetabaseCommand({
  meta: {
    name: "update",
    description: "Update a table (display name, description, visibility, etc.)",
  },
  details: [
    `Changes only the fields you send. \`display_name\`, \`entity_type\`, \`show_in_getting_started\`, \`field_order\` and \`collection_id\` don't take \`null\` (the server keeps the old value). Refused before the request (exit 2): \`data_authority: null\` on a server without \`${WITHDRAWAL_FEATURE}\` (${featureAvailability(WITHDRAWAL_FEATURE)}), and a medallion \`data_layer\` (\`gold\`, \`silver\`, \`bronze\`, \`copper\`) on a server with \`${TIER_FEATURE}\` (${featureAvailability(TIER_FEATURE)}).`,
    "Some patch releases ignore `collection_id`, so the command checks the table the server returns. If the table didn't move, the rest of the update still applies, and the command reports a `partial-write` error (exit 1) that names the collection the table stayed in.",
  ].join("\n\n"),
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
