import {
  DATA_ACTION_COLLECTION_GATE,
  DATA_ACTION_TABLE_GATE,
  DataAction,
  DataActionUpdateInput,
} from "@metabase/client/domain/data-action";
import { featureAvailability } from "@metabase/client/version/features";
import { dataActionView } from "../../output/views/data-action";
import { renderSummary } from "../../output/render";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";
import { DATA_ACTION_DATASET_QUERY, skipValidateFlag } from "../validate-query";

const COLLECTION_FEATURE = DATA_ACTION_COLLECTION_GATE.feature;
const TABLE_FEATURE = DATA_ACTION_TABLE_GATE.feature;

export default defineMetabaseCommand({
  meta: { name: "update", description: "Update a data action by id" },
  details: `The JSON body carries only the fields to change: any of \`name\`, \`parameters\`, \`collection_id\`, \`description\`, \`visualization_settings\` and \`archived\`, plus a query action's \`dataset_query\` or a table action's \`kind\` and \`table_id\`, never both. \`collection_id\` needs \`${COLLECTION_FEATURE}\` (${featureAvailability(COLLECTION_FEATURE)}) and \`table_id\` needs \`${TABLE_FEATURE}\` (${featureAvailability(TABLE_FEATURE)}); the CLI refuses them on an older server, which would ignore them but answer as if it had applied them. A new MBQL 5 \`dataset_query\` is checked against the bundled schema (\`mb schema query\`) before it's sent.`,
  skills: [{ skill: "data-action", purpose: "the fields of a data action" }],
  requires: ["dataAction.update"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...bodyInputFlags,
    ...skipValidateFlag,
    id: { type: "positional", description: "Data action id", required: true },
  },
  inputSchema: DataActionUpdateInput,
  embeddedDocuments: [DATA_ACTION_DATASET_QUERY],
  outputSchema: DataAction,
  examples: [
    "cat patch.json | mb data-action update 1",
    "mb data-action update 1 --file patch.json",
    'mb data-action update 1 --body \'{"name":"Rename an order"}\'',
  ],
  async run({ args, ctx, getClient, readBody }) {
    const id = parseId(args.id);
    const body = await readBody({ flag: args.body, file: args.file });
    const client = await getClient();
    const updated = await client.dataAction.update(id, body);
    renderSummary(
      updated,
      dataActionView,
      `Updated data action ${updated.id} "${updated.name}".`,
      ctx,
    );
  },
});
