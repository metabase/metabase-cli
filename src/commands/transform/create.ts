import { Transform, TransformCreateInput, transformView } from "../../domain/transform";
import { renderItem } from "../../output/render";
import { readBody } from "../../runtime/body";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";
import {
  TRANSFORM_SOURCE_QUERY_LABELS,
  preflightMbql5Query,
  skipValidateFlag,
} from "../validate-query";

export default defineMetabaseCommand({
  meta: {
    name: "create",
    description:
      "Create a transform. An MBQL 5 source.query is pre-flight-validated; see `mb skills get mbql`.",
  },
  capabilities: { minVersion: 59, edition: "oss" },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...bodyInputFlags,
    ...skipValidateFlag,
  },
  outputSchema: Transform,
  examples: [
    "cat transform.json | mb transform create",
    "mb transform create --file transform.json",
    "mb transform create --file transform.json --skip-validate",
  ],
  async run({ args, ctx, getClient }) {
    const body = await readBody({ flag: args.body, file: args.file }, TransformCreateInput);
    if (body.source.type === "query") {
      preflightMbql5Query(body.source.query, TRANSFORM_SOURCE_QUERY_LABELS, {
        skip: args["skip-validate"] === true,
      });
    }
    const client = await getClient();
    const created = await client.requestParsed(Transform, "/api/transform", {
      method: "POST",
      body,
    });
    renderItem(created, transformView, ctx);
  },
});
