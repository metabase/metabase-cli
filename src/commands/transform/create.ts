import { Transform, TransformCreateInput, transformView } from "../../domain/transform";
import { renderItem } from "../../output/render";
import { readBody } from "../../runtime/body";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "create", description: "Create a transform" },
  args: { ...outputFlags, ...profileFlag, ...connectionFlags, ...bodyInputFlags },
  outputSchema: Transform,
  examples: [
    "cat transform.json | metabase transform create",
    "metabase transform create --file transform.json",
  ],
  async run({ args, ctx, getClient }) {
    const body = await readBody({ flag: args.body, file: args.file }, TransformCreateInput);
    const client = await getClient();
    const created = await client.requestParsed(Transform, "/api/transform", {
      method: "POST",
      body,
    });
    renderItem(created, transformView, ctx);
  },
});
