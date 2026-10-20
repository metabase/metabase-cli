import { DataAction, DataActionCreateInput } from "@metabase/client/domain/data-action";
import { dataActionView } from "../../output/views/data-action";
import { renderSummary } from "../../output/render";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";
import { DATA_ACTION_DATASET_QUERY, skipValidateFlag } from "../validate-query";

export default defineMetabaseCommand({
  meta: { name: "create", description: "Create a data action from JSON" },
  details:
    'A data action is a parameterized native query that writes to a database, filed in a collection. The JSON body needs `name`, `type: "query"`, `database_id`, a native `dataset_query` whose `{{tag}}` placeholders are its inputs, and `parameters` targeting those tags; `collection_id` picks a collection in the `data-actions` or `data-apps` namespace (omit for the data actions root; a regular collection is refused). Data actions must be enabled on the database (`mb db set-data-actions <id> true`). An MBQL 5 `dataset_query` is checked against a bundled JSON Schema (print it with `mb schema query`) before sending; pass --skip-validate to bypass.',
  skills: [
    { skill: "data-action", purpose: "author a data action and its parameters" },
    { skill: "native-sql", purpose: "the native query and its template tags" },
  ],
  requires: ["dataAction.create"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...bodyInputFlags,
    ...skipValidateFlag,
  },
  inputSchema: DataActionCreateInput,
  embeddedDocuments: [DATA_ACTION_DATASET_QUERY],
  outputSchema: DataAction,
  examples: [
    "cat data-action.json | mb data-action create",
    "mb data-action create --file data-action.json",
    "mb data-action create --file data-action.json --skip-validate",
  ],
  async run({ args, ctx, getClient, readBody }) {
    const body = await readBody({ flag: args.body, file: args.file });
    const client = await getClient();
    const created = await client.dataAction.create(body);
    renderSummary(
      created,
      dataActionView,
      `Created data action ${created.id} "${created.name}".`,
      ctx,
    );
  },
});
