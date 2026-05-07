import { Transform, TransformCreateInput, transformView } from "../../domain/transform";
import { renderItem } from "../../output/render";
import { readBody } from "../../runtime/body";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";
import { preflightInternalMbql5Query } from "../validate-query";

export default defineMetabaseCommand({
  meta: {
    name: "create",
    description:
      "Create a transform; if source.type is `query` and source.query is MBQL 5 (lib/type: mbql/query) it is pre-flight-validated against the same schema as `metabase query` (see `metabase query --print-schema`)",
  },
  args: { ...outputFlags, ...profileFlag, ...connectionFlags, ...bodyInputFlags },
  outputSchema: Transform,
  examples: [
    "cat transform.json | metabase transform create",
    "metabase transform create --file transform.json",
  ],
  async run({ args, ctx, getClient }) {
    const body = await readBody({ flag: args.body, file: args.file }, TransformCreateInput);
    if (body.source.type === "query") {
      preflightInternalMbql5Query(body.source.query, "transform.source.query validation failed");
    }
    const client = await getClient();
    const created = await client.requestParsed(Transform, "/api/transform", {
      method: "POST",
      body,
    });
    renderItem(created, transformView, ctx);
  },
});
