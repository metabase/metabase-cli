import {
  TransformJob,
  TransformJobCreateInput,
  transformJobView,
} from "../../domain/transform-job";
import { renderItem } from "../../output/render";
import { readBody } from "../../runtime/body";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "create", description: "Create a transform job" },
  capabilities: { minVersion: 59, edition: "oss" },
  args: { ...outputFlags, ...profileFlag, ...connectionFlags, ...bodyInputFlags },
  outputSchema: TransformJob,
  examples: [
    "cat job.json | mb transform-job create",
    "mb transform-job create --file job.json",
    'mb transform-job create --body \'{"name":"daily","schedule":"0 0 0 * * ?"}\'',
  ],
  async run({ args, ctx, getClient }) {
    const body = await readBody({ flag: args.body, file: args.file }, TransformJobCreateInput);
    const client = await getClient();
    const created = await client.requestParsed(TransformJob, "/api/transform-job", {
      method: "POST",
      body,
    });
    renderItem(created, transformJobView, ctx);
  },
});
