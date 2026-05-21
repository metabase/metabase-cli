import { Transform, TransformUpdateInput, transformView } from "../../domain/transform";
import { renderItem } from "../../output/render";
import { readBody } from "../../runtime/body";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";
import {
  TRANSFORM_SOURCE_QUERY_LABELS,
  preflightMbql5Query,
  skipValidateFlag,
} from "../validate-query";

export default defineMetabaseCommand({
  meta: {
    name: "update",
    description: "Update a transform by id (partial)",
  },
  details:
    "Patches only the fields you send (any of `name`, `source`, `target`, `tag_ids`, …). When a new `source.query` is an MBQL 5 query it is checked against a bundled JSON Schema before sending; pass --skip-validate to bypass. See `mb skills get mbql`.",
  capabilities: { minVersion: 59 },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...bodyInputFlags,
    id: { type: "positional", description: "Transform id", required: true },
    ...skipValidateFlag,
  },
  outputSchema: Transform,
  examples: [
    "cat patch.json | mb transform update 1",
    "mb transform update 1 --file patch.json",
    'mb transform update 1 --body \'{"name":"renamed"}\'',
    "mb transform update 1 --file patch.json --skip-validate",
  ],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const body = await readBody({ flag: args.body, file: args.file }, TransformUpdateInput);
    if (body.source !== undefined && body.source.type === "query") {
      preflightMbql5Query(body.source.query, TRANSFORM_SOURCE_QUERY_LABELS, {
        skip: args["skip-validate"] === true,
      });
    }
    const client = await getClient();
    const updated = await client.requestParsed(Transform, `/api/transform/${id}`, {
      method: "PUT",
      body,
    });
    renderItem(updated, transformView, ctx);
  },
});
