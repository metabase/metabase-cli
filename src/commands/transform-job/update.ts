import {
  TransformJob,
  TransformJobUpdateInput,
  transformJobView,
} from "../../domain/transform-job";
import { renderItem } from "../../output/render";
import { readBody } from "../../runtime/body";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "update", description: "Update a transform job by id" },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...bodyInputFlags,
    id: { type: "positional", description: "Transform job id", required: true },
  },
  outputSchema: TransformJob,
  examples: [
    "cat patch.json | metabase transform-job update 1",
    "metabase transform-job update 1 --file patch.json",
    'metabase transform-job update 1 --body \'{"schedule":"0 0 6 * * ?"}\'',
  ],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const body = await readBody({ flag: args.body, file: args.file }, TransformJobUpdateInput);
    const client = await getClient();
    const updated = await client.requestParsed(TransformJob, `/api/transform-job/${id}`, {
      method: "PUT",
      body,
    });
    renderItem(updated, transformJobView, ctx);
  },
});
