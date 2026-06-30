import {
  TransformTag,
  TransformTagCreateInput,
  transformTagView,
} from "../../domain/transform-tag";
import { renderSummary } from "../../output/render";
import { readBody } from "../../runtime/body";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "create", description: "Create a transform tag" },
  capabilities: { minVersion: 59 },
  args: { ...outputFlags, ...profileFlag, ...connectionFlags, ...bodyInputFlags },
  outputSchema: TransformTag,
  examples: [
    'mb transform-tag create --body \'{"name":"nightly"}\'',
    "mb transform-tag create --file tag.json",
    'echo \'{"name":"nightly"}\' | mb transform-tag create',
  ],
  async run({ args, ctx, getClient }) {
    const body = await readBody({ flag: args.body, file: args.file }, TransformTagCreateInput);
    const client = await getClient();
    const created = await client.requestParsed(TransformTag, "/api/transform-tag", {
      method: "POST",
      body,
    });
    renderSummary(
      created,
      transformTagView,
      `Created transform tag ${created.id} "${created.name}".`,
      ctx,
    );
  },
});
