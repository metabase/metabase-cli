import { Transform, TransformCreateInput } from "@metabase/client/domain/transform";
import { transformView } from "../../output/views/transform";
import { renderSummary } from "../../output/render";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";
import { TRANSFORM_SOURCE_QUERY, skipValidateFlag } from "../validate-query";

import { enrichTransformCollectionError } from "./collection-namespace";

export default defineMetabaseCommand({
  meta: {
    name: "create",
    description: "Create a transform from JSON",
  },
  details:
    'The JSON body needs a `name`, a `source` and a `target`. A query source is `type: "query"` with the native SQL or MBQL query to run under `query`; a Python source is `type: "python"` with its `body` and `source-tables`. The `target` is the warehouse table to write: `type` (`"table"`, or `"table-incremental"` with a `target-incremental-strategy`) and `name`, plus an optional `schema` and `database`. `mb schema transform create` prints every field.',
  skills: [{ skill: "mbql", purpose: "MBQL source.query bodies" }],
  requires: ["transform.create"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...bodyInputFlags,
    ...skipValidateFlag,
  },
  inputSchema: TransformCreateInput,
  embeddedDocuments: [TRANSFORM_SOURCE_QUERY],
  outputSchema: Transform,
  examples: [
    "cat transform.json | mb transform create",
    "mb transform create --file transform.json",
    "mb transform create --file transform.json --skip-validate",
  ],
  async run({ args, ctx, getClient, readBody }) {
    const body = await readBody({ flag: args.body, file: args.file });
    const client = await getClient();
    const created = await client.transform.create(body).catch((error: unknown) => {
      throw enrichTransformCollectionError(error);
    });
    renderSummary(
      created,
      transformView,
      `Created transform ${created.id} "${created.name}".`,
      ctx,
    );
  },
});
