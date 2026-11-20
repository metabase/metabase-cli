import { DataAction, DataActionCreateInput } from "@metabase/client/domain/data-action";
import { dataActionView } from "../../output/views/data-action";
import { renderSummary } from "../../output/render";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";
import { DATA_ACTION_DATASET_QUERY, skipValidateFlag } from "../validate-query";

export default defineMetabaseCommand({
  meta: { name: "create", description: "Create a data action from JSON" },
  details: [
    "A data action writes to a database. It's filed in a collection and has no model (no `model_id`). Data actions are off by default: an admin turns them on for the database first (`mb db set-data-actions <id> true`).",
    'A table action inserts, updates or deletes one row: the JSON body needs `name`, `type: "implicit"`, `kind` (`row/create`, `row/update` or `row/delete`) and the `table_id` of a table with exactly one primary key. Metabase derives its parameters from the table\'s columns.',
    'A query action is a parameterized native SQL write (`INSERT`, `UPDATE`, `DELETE`): the body needs `name`, `type: "query"`, a native `dataset_query` whose `{{tag}}` placeholders are its inputs and whose `database` it writes to, and `parameters` that target those tags. An MBQL 5 `dataset_query` is checked against the bundled schema (`mb schema query`) before it\'s sent.',
    "`collection_id` picks a collection in the `data-actions` or `data-apps` namespace; leave it out for the data actions root. A regular collection is refused, and a data app's collection takes a table action only on a table published to the Library.",
  ].join("\n\n"),
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
    'mb data-action create --body \'{"name":"Add customer","type":"implicit","kind":"row/create","table_id":12}\'',
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
