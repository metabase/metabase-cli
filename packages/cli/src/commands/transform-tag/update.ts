import {
  TransformTag,
  TransformTagUpdateInput,
  transformTagView,
} from "../../domain/transform-tag";
import { renderSummary } from "../../output/render";
import { readBody } from "../../runtime/body";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "update", description: "Update a transform tag by id" },
  capabilities: { minVersion: 59 },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...bodyInputFlags,
    id: { type: "positional", description: "Transform tag id", required: true },
  },
  inputSchema: TransformTagUpdateInput,
  outputSchema: TransformTag,
  examples: [
    'mb transform-tag update 5 --body \'{"name":"renamed"}\'',
    "mb transform-tag update 5 --file tag.json",
    'echo \'{"name":"renamed"}\' | mb transform-tag update 5',
  ],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const body = await readBody({ flag: args.body, file: args.file }, TransformTagUpdateInput);
    const client = await getClient();
    const updated = await client.requestParsed(TransformTag, `/api/transform-tag/${id}`, {
      method: "PUT",
      body,
    });
    renderSummary(
      updated,
      transformTagView,
      `Updated transform tag ${updated.id} "${updated.name}".`,
      ctx,
    );
  },
});
