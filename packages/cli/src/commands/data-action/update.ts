import { DataAction, DataActionUpdateInput } from "@metabase/client/domain/data-action";
import { dataActionView } from "../../output/views/data-action";
import { renderSummary } from "../../output/render";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";
import { DATA_ACTION_DATASET_QUERY, skipValidateFlag } from "../validate-query";

export default defineMetabaseCommand({
  meta: { name: "update", description: "Update a data action by id" },
  details:
    "The JSON body carries only the fields to change. A new MBQL 5 `dataset_query` is checked against a bundled JSON Schema (print it with `mb schema query`) before sending; pass --skip-validate to bypass.",
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
