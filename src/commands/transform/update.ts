import { Transform, TransformUpdateInput, transformView } from "../../domain/transform";
import { renderItem } from "../../output/render";
import { readBody } from "../../runtime/body";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "update", description: "Update a transform by id" },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...bodyInputFlags,
    id: { type: "positional", description: "Transform id", required: true },
  },
  outputSchema: Transform,
  examples: [
    "cat patch.json | metabase transform update 1",
    "metabase transform update 1 --file patch.json",
    'metabase transform update 1 --body \'{"name":"renamed"}\'',
  ],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const body = await readBody({ flag: args.body, file: args.file }, TransformUpdateInput);
    const client = await getClient();
    const updated = await client.requestParsed(Transform, `/api/transform/${id}`, {
      method: "PUT",
      body,
    });
    renderItem(updated, transformView, ctx);
  },
});
